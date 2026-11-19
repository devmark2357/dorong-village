package online.laboon.dorong;

import static org.junit.Assert.*;

import org.junit.Test;

public class OtaAssetFallbackTest {

    private static final String B = "/data/user/0/online.laboon.dorong/files/versions/abc";

    @Test
    public void relativePath_onlyForBundleFiles() {
        assertEquals("art/ch1/bg.webp", OtaAssetFallback.relativePath(B, "/art/ch1/bg.webp"));
        assertEquals("proto.html", OtaAssetFallback.relativePath(B, "/proto.html"));
        // 기본 묶음(assets) → 대체 안 함
        assertNull(OtaAssetFallback.relativePath("public", "/art/a.webp"));
        assertNull(OtaAssetFallback.relativePath(null, "/art/a.webp"));
        // index.html · 확장자 없는 길 · 폴더 · Capacitor 내부
        assertNull(OtaAssetFallback.relativePath(B, "/"));
        assertNull(OtaAssetFallback.relativePath(B, "/index.html"));
        assertNull(OtaAssetFallback.relativePath(B, "/lobby"));
        assertNull(OtaAssetFallback.relativePath(B, "/art/"));
        assertNull(OtaAssetFallback.relativePath(B, "/_capacitor_file_/data/x.webp"));
        // 위로 가기
        assertNull(OtaAssetFallback.relativePath(B, "/../secret.txt"));
        assertNull(OtaAssetFallback.relativePath(B, "/art/../../x.js"));
        assertNull(OtaAssetFallback.relativePath(B, "/art//x.js"));
    }

    @Test
    public void parseRange() {
        assertArrayEquals(new long[] { 0, 99 }, OtaAssetFallback.parseRange("bytes=0-", 100));
        assertArrayEquals(new long[] { 10, 19 }, OtaAssetFallback.parseRange("bytes=10-19", 100));
        assertArrayEquals(new long[] { 10, 99 }, OtaAssetFallback.parseRange("bytes=10-500", 100));
        assertArrayEquals(new long[] { 90, 99 }, OtaAssetFallback.parseRange("bytes=-10", 100));
        assertNull(OtaAssetFallback.parseRange("bytes=100-", 100));
        assertNull(OtaAssetFallback.parseRange("bytes=5-1", 100));
        assertNull(OtaAssetFallback.parseRange("bytes=0-1,5-6", 100));
        assertNull(OtaAssetFallback.parseRange("items=0-1", 100));
    }

    @Test
    public void mime() {
        assertEquals("application/javascript", OtaAssetFallback.mimeOf("a/b.js"));
        assertEquals("image/webp", OtaAssetFallback.mimeOf("a/b.WEBP"));
        assertEquals("video/mp4", OtaAssetFallback.mimeOf("v.mp4"));
        assertEquals("audio/mpeg", OtaAssetFallback.mimeOf("s.mp3"));
    }
}
