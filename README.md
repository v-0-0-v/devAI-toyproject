# ZEP Mini MVP

[ZEP](https://zep.us)(2D 도트 메타버스 플랫폼)의 핵심 뼈대만 구현한 미니 MVP입니다.

## 포함된 기능

- 2D 타일맵 (벽 충돌 포함)
- 방향키(화살표/WASD)로 아바타 이동 (타일 그리드 기반)
- WebSocket(Socket.IO) 기반 실시간 멀티플레이어 위치 동기화
  - 접속 시 닉네임 입력 → 랜덤 스폰
  - 다른 플레이어의 이동/입장/퇴장이 실시간으로 반영
- **근접 기반 화상/음성 채팅 (mediasoup SFU)**
  - 아바타 간 거리가 3타일 이내로 가까워지면 서버가 감지해 자동으로 화상채팅 연결을 시작하고, 멀어지면 자동 종료
  - 각 클라이언트는 자신의 카메라/마이크를 서버(mediasoup)로 딱 한 번만 전송(Producer)하고, 서버가 근처에 있는 다른 클라이언트에게 그걸 중계(Consumer)함 — 참가자 쌍마다 별도 연결을 맺던 이전 P2P 방식과 달리 대역폭이 참가자 수에 비례해서만 늘어남
  - 서버가 항상 연결의 한쪽 끝이라 클라이언트 간 NAT 트래버설 문제 자체가 없음(TURN 불필요) — 대신 서버 자신의 미디어 포트(UDP/TCP)가 클라이언트에서 직접 도달 가능해야 함 (`server/src/sfu.ts`, 배포 시 `MEDIASOUP_ANNOUNCED_IP` 필요 — 아래 참고)
  - 화면 상단 비디오 바에 내 화면 + 근처 참가자 화면 타일 표시, 마이크/카메라 개별 on-off 토글
  - 카메라/마이크 권한이 없어도 게임 자체는 정상 동작 (수신만 되거나 완전히 비활성)
  - 수평 확장(Redis) 구성에서는 미니게임과 같은 이유로 인스턴스별 로컬 상태 — 두 플레이어가 같은 인스턴스에 붙어야 미디어가 오감
- **공간 음향 (Spatial Audio)**
  - 근접 화상채팅의 오디오는 `<video>` 태그로 직접 재생하지 않고 Web Audio API(`PannerNode`)로 라우팅 — 상대와의 타일 거리에 비례해 볼륨이 줄고 좌우 방향에 따라 패닝됨 (ZEP/Gather와 동일한 방식)
- **텍스트 채팅 (전체 / 근처)**
  - 우측 하단 채팅창에서 "전체"(맵의 모든 플레이어) 또는 "근처"(화상채팅과 동일한 근접 반경) 범위를 선택해 전송
  - 채팅 입력창에 포커스가 있는 동안에는 이동/리액션 단축키가 비활성화됨 (Esc로 포커스 해제)
- **이모지 리액션**
  - 숫자 1~6 키로 아바타 머리 위에 리액션(👍❤️😂😮👏🎉)을 잠깐 띄움 — 서버가 허용 목록을 검증 후 전체에 브로드캐스트
- **모바일 터치 조작**
  - `pointer: coarse`(터치스크린) 기기에서는 화면 좌측 하단에 방향 D-패드가 자동으로 나타남 — 데스크톱은 기존처럼 키보드만 사용
- **화면 공유**
  - 로컬 비디오 타일의 🖥️ 버튼으로 카메라 트랙을 화면 캡처 트랙으로 교체(`RTCRtpSender.replaceTrack`) — 재협상 없이 통화 중 즉시 전환되며, 브라우저의 "공유 중지" 클릭도 자동 감지해 카메라로 복귀
  - 단순화를 위해 카메라와 화면을 같은 타일에서 전환하는 방식이며, 별도의 화면 공유 전용 타일은 두지 않음
- **프라이빗 회의실 (방음 구역)**
  - 맵 안에 벽으로 둘러싸인 "회의실"이 있음 — 방 안/밖에 있는 두 사람은 타일 거리가 근접 반경 이내여도 절대 화상통화가 연결되지 않고, 근처 채팅도 방을 넘어가지 않음 (같은 방 안에서는 기존과 동일하게 거리 기반으로 동작)
- **오브젝트 상호작용 (화이트보드 / 같이 보기)**
  - 회의실 안의 특정 타일에 서면 실시간 공유 화이트보드가 열림 — 그림은 서버가 중계하고, 최근 스트로크 기록을 보관해 나중에 들어온 사람도 지금까지 그려진 내용을 봄
  - 다른 타일에 서면 유튜브 영상이 임베드된 "같이 보기" 화면이 열림 (재생은 각자 독립적 — 동기화는 안 됨)
  - 타일에서 벗어나면 자동으로 닫힘
- **아바타 색상 커스터마이징**
  - 로그인 화면에서 6가지 색상 중 하나를 선택해 입장 (서버가 허용 목록으로 검증, 미선택/무효값은 랜덤 배정으로 폴백)
- **최소 모더레이션 (로컬 음소거 / 차단 / 신고)**
  - 상대방 비디오 타일에서 🔇(나에게만 음소거) · 🚫(통화 종료 + 이 세션 동안 재연결 차단) · 🚩(서버에 신고 로그 남김) 사용 가능
  - 전부 세션 스코프(새로고침하면 초기화)이며 서버가 강제하지 않는 클라이언트 로컬 기능
- **미니게임 (가위바위보)**
  - 맵의 미니게임 타일에 서면 다음에 들어오는 상대와 자동 매칭되어 실시간으로 대결 — 둘 다 서버가 판정하고 결과를 각자에게 통보
- **맵 데이터 JSON 외부화**
  - 타일/벽/방/오브젝트 배치가 `server/src/mapdata.json` 한 파일로 분리되어 있어 코드를 건드리지 않고 맵을 바꿀 수 있음 (`MAP_DATA_PATH` 환경변수로 다른 파일 지정도 가능)
- **서버 강제 모더레이션 (관리자 IP 차단 + 신고 로그 열람)**
  - `ADMIN_TOKEN` 환경변수를 설정하면 URL에 `?admin=토큰`으로 접속해 관리자 패널(접속자 목록 + 차단 버튼 + 신고 로그)을 사용할 수 있음
  - Tier 2의 클라이언트 로컬 차단과 달리 IP 단위로 서버가 직접 차단 — 새로고침/다른 탭으로도 재접속 불가, Redis 연동 시 모든 인스턴스에 공유됨
  - 🚩 신고 버튼으로 접수된 신고는 서버에 영구 저장되고(아래 참고), 관리자 패널의 "신고 로그" 섹션에서 신고자/대상/사유/시각을 확인 가능
- **Socket.IO Redis 어댑터 (수평 확장)**
  - `REDIS_URL`을 설정하면 여러 서버 프로세스가 같은 Redis를 공유해 하나의 로드밸런서 뒤에서 동작 가능 — 접속자 목록·통화 상태·화이트보드·차단 목록이 인스턴스 간에 실시간으로 동기화됨 (실제로 2개 프로세스 + Redis로 교차 인스턴스 채팅/이동/화상통화 신호 전달을 검증함)
  - 미니게임 매칭만 예외 — 인스턴스별 인메모리 상태라 두 플레이어가 같은 인스턴스에 붙어야 매칭됨 (`server/src/store.ts` 참고)
- **영구 저장 (화이트보드 / 신고 로그)**
  - 화이트보드 스트로크와 신고 로그가 SQLite(Node 내장 `node:sqlite`)에 기록되어 서버 재시작(및 Redis 재시작)에도 사라지지 않음 — 재시작 직후 화이트보드에 다시 들어가면 이전 그림이 그대로 복원됨 (`server/src/persistence.ts`)
  - 수평 확장(Redis) 구성에서는 인스턴스별 로컬 파일이라 완전한 중앙 집중 저장은 아님 — 프로덕션이라면 공유 DB로 바꾸는 게 정석이지만, 미니 MVP 스코프에서는 허용 가능한 단순화로 남겨둠
  - Docker 배포 시 `docker-compose.prod.yml`이 `/app/data`를 named volume으로 마운트해 컨테이너 재생성에도 유지됨
- **웹 기반 시각적 맵 에디터**
  - `client/editor.html`에서 벽 칸 클릭/드래그로 토글, 방(Room)/오브젝트 추가·삭제, 맵 크기 조정을 그래픽으로 수행 가능 — `ADMIN_TOKEN`으로 저장(POST `/api/map`), 조회(GET `/api/map`)는 인증 불필요
  - 저장은 `mapdata.json`을 직접 덮어쓰며(이전 파일은 `.bak`으로 자동 백업) 실행 중인 서버에 즉시 반영되지는 않음 — 적용하려면 서버 재시작 필요 (실시간 핫스왑은 스코프 밖)
  - 오브젝트 타입이 "script"면 코드 입력용 textarea가 나타남 (아래 ZEP Script 참고)
- **ZEP Script (커스텀 스크립팅 API)**
  - 맵의 "script" 타입 오브젝트에 JavaScript 코드를 붙여 커스텀 동작을 만들 수 있음 — 플레이어가 타일을 밟을 때(`$.onEnter`)/벗어날 때(`$.onLeave`)/일정 주기마다(`$.onInterval`) 실행되는 핸들러를 등록
  - API: `$.onEnter(fn)` / `$.onLeave(fn)` / `$.onInterval(ms, fn)`, `$.say(playerId, text)`(1인 시스템 메시지), `$.broadcast(text)`(전체 시스템 메시지), `$.teleport(playerId, x, y)`, `$.log(...)`(디버그). 스크립트 최상위 `let`/`var`는 서버가 켜져 있는 동안 그대로 유지되는 상태로 쓸 수 있음 (별도 getState/setState API 불필요)
  - **보안**: 스크립트는 신뢰할 수 없는 사용자 입력이라, QuickJS를 WebAssembly로 컴파일한 실제 격리 샌드박스(`quickjs-emscripten`)에서 실행됨 — Node 공식 문서가 "보안 경계 아님"이라 명시하는 `vm` 모듈이 아니라 아예 별개의 JS 엔진이라 `require`/`process`/네트워크/파일시스템에 원천적으로 접근 불가. 무한 루프는 200ms 후 강제 중단, 과도한 메모리 할당은 16MB 제한으로 차단 — `while(true){}`와 `Function` 생성자를 통한 탈출 시도로 직접 검증함
  - 예시 오브젝트(`script-1`, 맵 좌상단)는 방문자 수를 세고 환영 메시지를 보낸 뒤 다른 위치로 순간이동시키는 "텔레포트 패드"

## 구조

```
zep-mini-mvp/
├── docker-compose.yml       # 로컬 개발용 coturn (더 이상 앱이 쓰지 않음 — 아래 참고, 실행 자체가 선택)
├── docker-compose.prod.yml  # 실제 배포용: Caddy(TLS) + server(mediasoup 포함) + coturn(선택) 전체 스택
├── turnserver.conf          # coturn 개발용 설정 (더 이상 앱이 쓰지 않음)
├── turnserver.prod.conf     # coturn 배포용 설정 (더 이상 앱이 쓰지 않음)
├── deploy/                  # 배포 가이드, Caddyfile, systemd 유닛, certbot 갱신 훅
├── .github/workflows/ci.yml # 서버/클라이언트 빌드+스모크테스트, Docker 이미지 빌드 검증
├── server/   # Node.js + TypeScript + Express + Socket.IO + mediasoup (+ Dockerfile)
│             # 권위 서버: 이동 검증/브로드캐스트, 근접 판정, 채팅/리액션 중계·검증,
│             # mediasoup SFU 시그널링·미디어 중계, 미니게임 매칭, 관리자 IP 차단
│   ├── sfu.ts         # mediasoup worker/router 생성, WebRtcTransport 팩토리
│   ├── mapdata.json   # 타일/벽/방/오브젝트 정의 (map.ts가 런타임에 로드)
│   ├── mapEditor.ts   # GET/POST /api/map — 맵 에디터 저장 API + 검증
│   ├── persistence.ts # SQLite 영구 저장 (화이트보드 스트로크 + 신고 로그)
│   ├── zepScript.ts   # ZEP Script 샌드박스 (quickjs-emscripten, "script" 오브젝트 실행)
│   ├── turn.ts        # (더 이상 사용 안 함 — 아래 참고) coturn 크리덴셜 발급
│   ├── store.ts       # GameStore 인터페이스 + 인메모리 구현 (기본값)
│   └── redisStore.ts  # GameStore의 Redis 구현 (REDIS_URL 설정 시 사용)
└── client/   # Vite + TypeScript + Phaser 3
    ├── index.html      # 게임 페이지 (main.ts)
    │                   # 타일맵/방/오브젝트 렌더링, 입력, 아바타(scenes/GameScene.ts)
    │                   # mediasoup-client 기반 화상채팅 + 공간음향 + 화면공유
    │                   #   (webrtc.ts, videoChat.ts)
    │                   # 텍스트 채팅(chat.ts), 모바일 터치 D-패드(touchControls.ts)
    │                   # 화이트보드/유튜브 오브젝트(objectInteraction.ts)
    │                   # 로컬 음소거/차단/신고(moderation.ts)
    │                   # 가위바위보 미니게임(minigame.ts), 관리자 패널(adminPanel.ts)
    └── editor.html     # 맵 에디터 페이지 (editor.ts) — 독립된 Vite 멀티페이지 진입점
```

## 실행 방법

화상채팅(mediasoup)은 로컬 개발에서 추가 설정 없이 바로 동작합니다 — `server/.env`를 만들 필요조차 없습니다. (coturn 관련 `docker-compose.yml`/`.env`는 더 이상 앱이 쓰지 않는 예전 설정으로, 남겨두기만 했습니다.)

### 1. 서버

```bash
cd server
npm install
npm run dev   # http://localhost:3001
```

### 2. 클라이언트

```bash
cd client
npm install
npm run dev   # http://localhost:5173
```

브라우저 탭을 여러 개 열어 각각 다른 닉네임/색상으로 접속하면 서로의 아바타가 실시간으로 움직이는 것을 확인할 수 있습니다. 아바타를 서로 가까이 이동시키면 화면 상단에 화상채팅 타일이 자동으로 나타납니다 (카메라/마이크 권한 허용 필요). 우측 하단에서 텍스트 채팅, 숫자 1~6으로 리액션, 비디오 타일의 🖥️ 버튼으로 화면 공유, 🔇/🚫/🚩 버튼으로 상대방 로컬 음소거·차단·신고를 사용할 수 있습니다. 맵 중앙의 회의실(벽으로 둘러싸인 구역) 안에 있는 화이트보드/유튜브/가위바위보 타일 위를 걸으면 오브젝트가 열립니다.

`ADMIN_TOKEN`을 서버에 설정한 뒤 클라이언트에서 `?admin=토큰`으로 접속하면 좌측 상단에 관리자 패널(접속자 목록 + 차단 버튼 + 신고 로그)이 나타납니다.

### 3. (선택) 맵 에디터

`http://localhost:5173/editor.html`에서 현재 맵을 그래픽으로 편집할 수 있습니다 (불러오기는 토큰 없이 가능, 저장은 `ADMIN_TOKEN` 필요). 벽 모드에서 칸을 클릭/드래그해 벽 ↔ 바닥을 토글하고, 방 모드에서 두 지점을 클릭해 회의실 범위를 지정하고, 오브젝트 모드에서 칸을 클릭해 화이트보드/유튜브/미니게임/script 오브젝트 좌표를 채운 뒤 각각 폼에서 추가합니다. 타입을 "script"로 선택하면 코드 입력용 textarea가 나타나며, 여기 작성한 JavaScript가 샌드박스에서 실행됩니다 (API 목록은 위 "ZEP Script" 항목 참고). 저장하면 `mapdata.json`이 즉시 덮어써지지만(이전 파일은 `.bak`으로 자동 백업), **실행 중인 서버에는 반영되지 않으므로 적용하려면 서버를 재시작**해야 합니다.

### 4. (선택) 서버 단독 스모크 테스트

브라우저 없이 join/move/broadcast/근접(+방음 구역 격리)/mediasoup SFU 시그널링(+잘못된 입력에 대한 서버 안정성)/채팅/리액션/화이트보드(+영구 저장)/아바타색상/신고(+영구 저장)/미니게임/관리자차단/관리자 신고 로그 조회/ZEP Script(타일 진입 시 `$.say`/`$.broadcast`/`$.teleport` 동작) 플로우를 빠르게 검증하고 싶다면, 서버 실행 중에:

```bash
cd server
npm run smoke-test
```

관리자 차단·신고 로그 조회의 실제 인증 경로까지 검증하려면 서버와 스모크 테스트 둘 다 같은 `ADMIN_TOKEN`으로 실행하세요 (`ADMIN_TOKEN=아무값 npm run dev`, 다른 셸에서 `ADMIN_TOKEN=아무값 npm run smoke-test`). 이 경우 테스트가 실제로 `127.0.0.1`을 차단하므로, 같은 서버 프로세스에 대고 스모크 테스트를 다시 실행하면 이후 모든 연결이 거부됩니다 — 서버를 재시작해야 초기화됩니다.

SQLite 영구 저장 파일은 기본적으로 `server/data/zep.db`에 생성됩니다 (`DB_PATH` 환경변수로 위치 변경 가능). 처음부터 다시 검증하고 싶다면 서버를 끄고 `server/data/`를 삭제한 뒤 다시 실행하세요.

이 스모크 테스트는 브라우저 없는 순수 Node 클라이언트라 실제 ICE/DTLS 핸드셰이크는 할 수 없어서(WebRTC 스택 자체가 없음), mediasoup 관련 항목은 서버의 시그널링 응답 형태와 잘못된 입력에 대한 안정성만 검증합니다. 실제로 미디어(영상 프레임)가 SFU를 통해 흐르는지, 화면 공유 전환이 되는지, 근접 이탈 시 정리되는지는 실제 카메라/마이크를 흉내 낸 2탭 브라우저 테스트로 별도 검증했습니다 (Playwright + `--use-fake-device-for-media-stream`).

### 5. (선택) Redis로 여러 서버 인스턴스 실행

```bash
redis-server &
PORT=4001 REDIS_URL=redis://localhost:6379 npm run start   # server/ 에서, 빌드 후
PORT=4002 REDIS_URL=redis://localhost:6379 npm run start   # 다른 셸에서
```

두 인스턴스 모두에 접속해도 서로의 아바타/채팅/화상통화 신호가 정상적으로 오가면 정상 동작입니다 (로드밸런서 뒤에서는 WebSocket 특성상 스티키 세션이 필요합니다).

## 실제 배포 (프로덕션)

도메인 + VPS에 Caddy(자동 TLS) + 서버(mediasoup 포함)를 한 번에 올리는 `docker-compose.prod.yml` 구성이 준비되어 있습니다. DNS/방화벽 설정부터 systemd 유닛 설치까지 전 과정은 **[`deploy/DEPLOY.md`](deploy/DEPLOY.md)** 를 따라 하세요.

핵심 요약:
- **Caddy**가 정적 클라이언트를 서빙하고 `/socket.io`(시그널링) + `/api`(맵 에디터)를 서버로 프록시 — 클라이언트·서버가 같은 도메인(HTTPS)이라 CORS 설정이 필요 없고, TLS 인증서도 자동 발급/갱신됩니다.
- 서버의 시그널링 포트(3001)는 외부에 노출되지 않고 Caddy를 통해서만 접근 가능하지만, **mediasoup의 실제 화상채팅 미디어 포트(UDP/TCP, 기본 40000-40100)는 Caddy가 대신할 수 없는 실시간 트래픽이라 서버 컨테이너에서 직접 발행됩니다** — `MEDIASOUP_ANNOUNCED_IP`(VPS 공인 IP)를 반드시 설정해야 하고, 이 포트 범위를 방화벽에서 열어야 합니다.
- **coturn**은 예전 P2P 구조의 유물로, mediasoup 도입 이후로는 앱이 사용하지 않습니다. `docker-compose.prod.yml`에는 아직 남아 있지만(선택 서비스), 배포에 필수는 아닙니다.
- 도메인/인증서 없이 구성 파일만 미리 점검하고 싶다면 `deploy/DEPLOY.md` 맨 아래 "로컬에서 이 구성을 미리 점검하는 법" 참고 (`docker compose config`, `caddy validate`, `systemd-analyze verify`로 이미지 pull 없이 검증 가능).

## CI

`.github/workflows/ci.yml`이 push/PR마다 서버·클라이언트 빌드, 서버 스모크 테스트, Docker 이미지 빌드(서버 + Caddy/클라이언트), 프로덕션 `docker compose config` 검증을 자동으로 돌립니다. 이 개발 환경은 네트워크 정책상 Docker 데몬/이미지 pull에 접근할 수 없어 `docker build` 자체는 이 환경에서 실행·확인하지 못했지만, GitHub Actions 러너에서는 정상적으로 pull이 가능합니다.

## 다음 단계 제안

ZEP/Gather/Topia/WorkAdventure 등 유사 플랫폼 벤치마크를 바탕으로 우선순위를 매겨두었던 목록이었습니다. 텍스트 채팅·리액션·공간음향·모바일 조작·화면 공유·프라이빗 회의실·오브젝트 상호작용·아바타 색상·모더레이션·미니게임·맵 JSON 외부화 + 시각적 에디터·Redis 수평 확장·영구 저장·CI·mediasoup SFU 전환에 이어, 마지막으로 남아있던 대형 항목이던 ZEP Script(커스텀 스크립팅 API, QuickJS 기반 보안 샌드박스)까지 구현을 완료해 벤치마크 목록의 모든 항목이 구현되었습니다.

이후 방향을 잡는다면 다음과 같은 것들을 고려할 수 있습니다 (모두 이 미니 MVP 스코프를 넘어서는, 실서비스 전환 시의 과제들):

- 영구 저장(SQLite)·미니게임 매칭·ZEP Script 상태를 Redis/공유 DB로 옮겨 수평 확장 시에도 완전히 인스턴스 독립적으로 만들기
- ZEP Script API 확장 (오브젝트 간 통신, `getState`/`setState` 영속화, 스크립트별 리소스 사용량 대시보드 등)
- 실시간 맵 핫스왑 (현재는 에디터 저장 후 서버 재시작 필요)
