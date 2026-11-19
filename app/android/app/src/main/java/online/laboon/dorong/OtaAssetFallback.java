package online.laboon.dorong;

import android.content.res.AssetFileDescriptor;
import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.io.File;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLConnection;
import java.util.HashMap;
import java.util.Map;

/**
 * W-35 「경로 분리」(1.4.1): OTA 묶음 폴더에 없는 파일은 APK 안 기본 파일(assets/public/…)에서 읽는다.
 *
 * 왜: @capgo/capacitor-updater가 묶음을 걸면 웹뷰가 묶음 폴더(files/versions/…)만 본다. 그래서 전에는 www 전체(약 180MB)를
 * 묶음 폴더로 복사해야 했다. 이제 안드로이드 묶음에는 바뀐 파일(+ index.html)만 넣고(meta/ota.ts · tools/ota/publish.mjs의 delta),
 * 나머지 요청은 여기서 APK assets로 돌린다 → OTA를 써도 기기에 더 쓰는 공간 = 바뀐 파일 크기(보통 몇 MB).
 *
 * 규칙(요청마다):
 *  - 기본 묶음(서버 경로가 assets) · 다른 호스트 · /_capacitor_file_/ · /_capacitor_content_/ · 확장자 없는 경로(= index.html) → Capacitor 그대로.
 *  - 묶음 폴더에 그 파일이 있으면 → Capacitor 그대로(묶음 파일).
 *  - 없고 APK assets/public/<경로>가 있으면 → 그 파일(Range 요청도 제대로 자름).
 *  - 둘 다 없으면 → Capacitor 그대로(전과 같은 404).
 * 묶음 내용이 그 APK와 맞는지는 JS가 내려받기 전에 확인한다(www/ota-base.txt = 기준 목록 id. 다르면 전처럼 전체 목록 → 플러그인이 복사).
 */
final class OtaAssetFallback extends BridgeWebViewClient {

    static final String ASSET_ROOT = "public";

    private final Bridge bridge;
    private final AssetManager assets;

    OtaAssetFallback(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
        this.assets = bridge.getContext().getAssets();
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        try {
            WebResourceResponse r = fallback(request);
            if (r != null) return r;
        } catch (Exception ignored) {
            // 대체 실패 → Capacitor 기본 처리
        }
        return super.shouldInterceptRequest(view, request);
    }

    private WebResourceResponse fallback(WebResourceRequest request) throws IOException {
        Uri url = request.getUrl();
        if (url == null || !"GET".equalsIgnoreCase(request.getMethod())) return null;
        if (bridge.getServerUrl() != null || url.getHost() == null || !url.getHost().equalsIgnoreCase(bridge.getHost())) return null;
        String root = bridge.getServerBasePath();
        String rel = relativePath(root, url.getPath());
        if (rel == null) return null;
        if (new File(root, rel).isFile()) return null; // 묶음에 있음 → 묶음 파일

        String assetPath = ASSET_ROOT + "/" + rel;
        long length = -1;
        try (AssetFileDescriptor fd = assets.openFd(assetPath)) {
            length = fd.getLength();
        } catch (IOException compressedOrMissing) {
            // 압축된 asset은 openFd가 안 된다 — 아래 open으로 있는지 확인
        }
        InputStream in;
        try {
            in = assets.open(assetPath, AssetManager.ACCESS_STREAMING);
        } catch (IOException missing) {
            return null; // APK에도 없음 → 기본 처리(404)
        }

        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        String mime = mimeOf(rel);
        String range = header(request, "Range");
        if (range != null && length > 0) {
            long[] r = parseRange(range, length);
            if (r != null) {
                skipFully(in, r[0]);
                headers.put("Accept-Ranges", "bytes");
                headers.put("Content-Range", "bytes " + r[0] + "-" + r[1] + "/" + length);
                headers.put("Content-Length", String.valueOf(r[1] - r[0] + 1));
                return new WebResourceResponse(mime, null, 206, "Partial Content", headers, new Limited(in, r[1] - r[0] + 1));
            }
        }
        if (length >= 0) headers.put("Content-Length", String.valueOf(length));
        return new WebResourceResponse(mime, null, 200, "OK", headers, in);
    }

    /**
     * 묶음 폴더(절대 경로) 아래 상대 경로. 대체하지 않을 요청이면 null.
     * root가 assets 경로(기본 묶음)거나 · Capacitor 내부 경로 · 확장자 없는 경로(index.html로 가는 길) · ..가 든 경로.
     */
    static String relativePath(String root, String path) {
        if (root == null || !root.startsWith("/") || path == null) return null;
        if (path.startsWith("/_capacitor_")) return null;
        String rel = path;
        while (rel.startsWith("/")) rel = rel.substring(1);
        if (rel.isEmpty() || rel.endsWith("/")) return null;
        String last = rel.substring(rel.lastIndexOf('/') + 1);
        if (!last.contains(".") || "index.html".equals(rel)) return null;
        for (String seg : rel.split("/")) {
            if (seg.isEmpty() || ".".equals(seg) || "..".equals(seg)) return null;
        }
        return rel;
    }

    /** "bytes=a-b" · "bytes=a-" · "bytes=-n" → {시작, 끝}(포함). 못 읽으면 null(전체로 보냄) */
    static long[] parseRange(String h, long length) {
        if (h == null || !h.trim().toLowerCase().startsWith("bytes=") || length <= 0) return null;
        String spec = h.trim().substring(6).trim();
        if (spec.contains(",")) return null;
        int dash = spec.indexOf('-');
        if (dash < 0) return null;
        try {
            String a = spec.substring(0, dash).trim(), b = spec.substring(dash + 1).trim();
            long start, end;
            if (a.isEmpty()) {
                if (b.isEmpty()) return null;
                long n = Long.parseLong(b);
                if (n <= 0) return null;
                start = Math.max(0, length - n);
                end = length - 1;
            } else {
                start = Long.parseLong(a);
                end = b.isEmpty() ? length - 1 : Math.min(Long.parseLong(b), length - 1);
            }
            if (start < 0 || start > end || start >= length) return null;
            return new long[] { start, end };
        } catch (NumberFormatException e) {
            return null;
        }
    }

    static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".mp4") || p.endsWith(".m4v")) return "video/mp4";
        if (p.endsWith(".webm")) return "video/webm";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".m4a")) return "audio/mp4";
        if (p.endsWith(".ogg")) return "audio/ogg";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".html")) return "text/html";
        String m = URLConnection.guessContentTypeFromName(path);
        return m != null ? m : "application/octet-stream";
    }

    private static String header(WebResourceRequest r, String name) {
        Map<String, String> h = r.getRequestHeaders();
        if (h == null) return null;
        for (Map.Entry<String, String> e : h.entrySet()) if (name.equalsIgnoreCase(e.getKey())) return e.getValue();
        return null;
    }

    private static void skipFully(InputStream in, long n) throws IOException {
        while (n > 0) {
            long s = in.skip(n);
            if (s <= 0) {
                if (in.read() < 0) return;
                s = 1;
            }
            n -= s;
        }
    }

    /** 남은 n바이트만 읽는 스트림(Range 끝) */
    private static final class Limited extends FilterInputStream {
        private long left;

        Limited(InputStream in, long n) {
            super(in);
            left = n;
        }

        @Override
        public int read() throws IOException {
            if (left <= 0) return -1;
            int b = super.read();
            if (b >= 0) left--;
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int n = super.read(b, off, (int) Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }

        @Override
        public int available() throws IOException {
            return (int) Math.min(super.available(), left);
        }
    }
}
