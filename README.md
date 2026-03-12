# 🎵 Character Music Player v1.3

캐릭터의 감정/상황에 따라 어울리는 음악을 카드로 표시하는 SillyTavern 확장입니다.

---

## 📦 설치 방법

1. 이 폴더(`character-music-player`)를 아래 경로에 복사하세요:
```
SillyTavern/public/extensions/third-party/character-music-player/
```
2. SillyTavern 재시작
3. Extensions 메뉴에서 **Character Music Player** 활성화

---

## 🎵 재생 방식

| 상황 | 동작 |
|------|------|
| **API 키 있음** | 앨범아트 표시 + ▶ 클릭 시 YouTube **새 탭**으로 바로 재생 |
| **API 키 없음** | ▶ 클릭 시 YouTube 검색 결과 **새 탭**으로 열림 |

> YouTube는 localhost origin에서의 embed 재생을 차단하므로, 실리태번 내부 재생은 지원하지 않습니다.

---

## 🔑 YouTube API 키 발급 (무료, 선택사항)

1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. 새 프로젝트 생성
3. **API 및 서비스 > 라이브러리**에서 `YouTube Data API v3` 활성화
4. **사용자 인증 정보**에서 `API 키` 생성 후 설정창에 입력

> 💡 하루 10,000 유닛 무료 (검색 1회 = 100 유닛 → 하루 100회)

---

## ⚙️ 설정 항목

| 설정 | 설명 |
|------|------|
| 확장 활성화 | 전체 켜기/끄기 |
| YouTube API 키 | 없어도 동작 (앨범아트 없이) |
| 카드 표시 최소 간격 | 카드가 너무 자주 뜨지 않도록 쿨다운 (기본 3분) |
| 트리거 민감도 | 낮음 / 보통 / 높음 |
| 카드 디자인 | 풀카드 / 미니 / 텍스트 |

---

## 🎯 트리거 조건

- **감정 묘사** — 분노, 슬픔, 설렘, 그리움, 외로움 등
- **음악 키워드** — 음악, 노래, 흥얼거림, BGM 등
- **시간/장소** — 새벽, 빗소리, 카페, 드라이브 등
- **높음 모드** — AI가 분위기를 직접 판단

---

## 📁 파일 구조

```
character-music-player/
├── manifest.json
├── index.js
├── style.css
├── settings.html
└── README.md
```
