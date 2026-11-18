# 느림마을 옷 제작 툴 (outfit worker)

「나만의 캐릭터 꾸미기」 주문의 마지막 단계를 맡아요. GitHub Actions에서 10분마다 돌고, `worker/` 파일이 바뀌어 올라오면 바로 한 번 더 돌아요.

1. `outfit` 함수(Supabase)에 GitHub 로그인 토큰(OIDC)으로 들어가요. 저장된 비밀값은 없어요.
2. WaveSpeed가 그린 어른 동작 시트 13장을 받아 `build.py`로 배경을 지우고 포즈를 잘라 한 장짜리 묶음(`pack_a.webp` + `pack.json`)을 만들어요.
3. 포즈 수가 틀린 시트는 그 장만 다시 그려 달라고 하고, 다 맞으면 저장소에 올려 배달해요.
