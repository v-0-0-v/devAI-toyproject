# ZEP Mini MVP

[ZEP](https://zep.us)(2D 도트 메타버스 플랫폼)의 핵심 뼈대만 구현한 미니 MVP입니다.

## 포함된 기능

- 2D 타일맵 (벽 충돌 포함)
- 방향키(화살표/WASD)로 아바타 이동 (타일 그리드 기반)
- WebSocket(Socket.IO) 기반 실시간 멀티플레이어 위치 동기화
  - 접속 시 닉네임 입력 → 랜덤 스폰
  - 다른 플레이어의 이동/입장/퇴장이 실시간으로 반영
- **근접 기반 화상/음성 채팅 (WebRTC)**
  - 아바타 간 거리가 3타일 이내로 가까워지면 서버가 감지해 자동으로 화상채팅 연결을 시작하고, 멀어지면 자동 종료
  - 시그널링(offer/answer/ICE candidate)은 Socket.IO로 중계, 실제 미디어는 WebRTC로 직접(P2P) 또는 TURN 경유로 전송
  - 화면 상단 비디오 바에 내 화면 + 근처 참가자 화면 타일 표시, 마이크/카메라 개별 on-off 토글
  - 카메라/마이크 권한이 없어도 게임 자체는 정상 동작 (수신만 되거나 완전히 비활성)
- **TURN 서버 (coturn)**
  - STUN만으로는 연결이 안 되는 네트워크(대칭형 NAT, 엄격한 사내망 방화벽 등)를 위한 릴레이
  - 서버가 접속마다 coturn REST API 방식의 시간 제한 크리덴셜(HMAC-SHA1)을 발급해 클라이언트에 전달 — 정적 비밀번호를 클라이언트에 노출하지 않음
  - TURN 미설정 시(로컬 `.env` 없음) 자동으로 STUN-only로 폴백, 앱 자체는 그대로 동작

## 포함되지 않은 것 (다음 단계)

- 웹 기반 맵 에디터
- ZEP Script 같은 커스텀 스크립팅 API
- 채팅(텍스트), 미니게임, 오브젝트 상호작용

## 구조

```
zep-mini-mvp/
├── docker-compose.yml       # 로컬 개발용: coturn만 (STUN-only로도 동작하니 선택 사항)
├── docker-compose.prod.yml  # 실제 배포용: Caddy(TLS) + server + coturn(TLS) 전체 스택
├── turnserver.conf          # coturn 개발용 설정 (TLS 없음)
├── turnserver.prod.conf     # coturn 배포용 설정 (TLS, 넓은 릴레이 포트 범위)
├── deploy/                  # 배포 가이드, Caddyfile, systemd 유닛, certbot 갱신 훅
├── server/   # Node.js + TypeScript + Express + Socket.IO (+ Dockerfile)
│             # 권위 서버: 이동 검증/브로드캐스트, 근접 판정, WebRTC 시그널링 중계, TURN 크리덴셜 발급
└── client/   # Vite + TypeScript + Phaser 3
              # 타일맵 렌더링, 입력, 아바타, WebRTC 화상채팅(webrtc.ts, videoChat.ts)
```

## 실행 방법

### 1. (선택) TURN 서버(coturn) 실행

화상채팅은 TURN 없이도 동작하지만(STUN-only 폴백), 일부 네트워크 환경 테스트를 위해 로컬에서 coturn을 띄우려면:

```bash
cp server/.env.example server/.env
# server/.env의 TURN_SECRET을 강력한 랜덤값으로 교체 (예: openssl rand -hex 32)
docker compose up -d
```

`docker-compose.yml`은 `server/.env`의 `TURN_SECRET`을 coturn 컨테이너에 주입합니다 — Node 서버가 같은 `.env`를 읽어 크리덴셜을 생성하므로 값이 자동으로 일치합니다. `.env`를 만들지 않으면 서버는 자동으로 STUN-only로 동작합니다.

### 2. 서버

```bash
cd server
npm install
npm run dev   # http://localhost:3001
```

### 3. 클라이언트

```bash
cd client
npm install
npm run dev   # http://localhost:5173
```

브라우저 탭을 여러 개 열어 각각 다른 닉네임으로 접속하면 서로의 아바타가 실시간으로 움직이는 것을 확인할 수 있습니다. 아바타를 서로 가까이 이동시키면 화면 상단에 화상채팅 타일이 자동으로 나타납니다 (카메라/마이크 권한 허용 필요).

### 4. (선택) 서버 단독 스모크 테스트

브라우저 없이 join/move/broadcast/근접/시그널링/iceServers 플로우를 빠르게 검증하고 싶다면, 서버 실행 중에:

```bash
cd server
npm run smoke-test
```

## 실제 배포 (프로덕션)

도메인 + VPS에 Caddy(자동 TLS) + 서버 + coturn(TLS)을 한 번에 올리는 `docker-compose.prod.yml` 구성이 준비되어 있습니다. DNS/방화벽 설정부터 certbot 인증서 발급, systemd 유닛 설치까지 전 과정은 **[`deploy/DEPLOY.md`](deploy/DEPLOY.md)** 를 따라 하세요.

핵심 요약:
- **Caddy**가 정적 클라이언트를 서빙하고 `/socket.io`를 서버로 프록시 — 클라이언트·서버가 같은 도메인(HTTPS)이라 CORS 설정이 필요 없고, TLS 인증서도 자동 발급/갱신됩니다.
- 서버는 외부에 포트를 노출하지 않고 Caddy를 통해서만 접근 가능합니다.
- **coturn**은 Docker host network + certbot이 발급한 자체 TLS 인증서(`turns:`)로 동작하며, 인증서 갱신 시 자동 재시작되도록 훅이 포함되어 있습니다.
- 도메인/인증서 없이 구성 파일만 미리 점검하고 싶다면 `deploy/DEPLOY.md` 맨 아래 "로컬에서 이 구성을 미리 점검하는 법" 참고 (`docker compose config`, `caddy validate`, `systemd-analyze verify`로 이미지 pull 없이 검증 가능).

## 다음 단계 제안

1. 참가자가 많아질 때를 대비해 mediasoup 같은 SFU로 전환 (현재는 참가자 쌍마다 P2P/TURN 연결이라 근접 인원이 많아지면 업링크 부하 증가)
2. 맵 데이터를 JSON 파일 업로드/에디터로 관리 (타일/오브젝트 배치 UI)
3. 오브젝트 상호작용 이벤트(키 입력 시 URL 팝업, iframe 임베드 등) 추가
4. Redis adapter로 Socket.IO 수평 확장 (다중 룸/다중 서버 인스턴스)
5. CI에서 `docker build`(서버/Caddy 이미지)까지 자동 검증 (이 세션은 네트워크 정책상 Docker Hub pull이 막혀 있어 이미지 빌드 자체는 실행하지 못하고 설정 파일 레벨로만 검증함)
