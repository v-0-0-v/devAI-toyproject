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
├── docker-compose.yml  # coturn (TURN 서버) 로컬/배포용
├── turnserver.conf     # coturn 설정 (비밀키는 파일에 두지 않고 CLI로 주입)
├── server/   # Node.js + TypeScript + Express + Socket.IO
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

## Production TURN 노트

로컬 `docker-compose.yml` / `turnserver.conf`는 개발용 최소 구성입니다. 실제 배포 시 고려할 점:

- **공인 IP 필요**: coturn은 클라이언트에게 자신의 릴레이 주소를 알려줘야 하므로, NAT/컨테이너 뒤에 있다면 `turnserver.conf`에 `external-ip=<공인IP>/<내부IP>`를 설정해야 합니다.
- **릴레이 포트 범위 개방**: `min-port`/`max-port`(기본 49160-49200)에 해당하는 UDP 포트 전체를 방화벽에서 열어야 하며, 동시 통화가 많다면 범위를 넓혀야 합니다 (통화당 1포트).
- **TLS 활성화**: `turnserver.conf`의 `no-tls`/`no-dtls`를 제거하고 실제 인증서를 연결해 `turns:` 스킴을 사용하세요 — 그래야 크리덴셜이 평문으로 오가지 않습니다.
- **`TURN_URLS` 갱신**: `server/.env`의 `TURN_URLS`를 배포된 공인 호스트/포트(예: `turn:turn.example.com:3478`)로 바꿔야 클라이언트가 실제로 연결할 수 있습니다.
- **`--allow-loopback-peers`는 사용하지 마세요**: 로컬 테스트 시에만 임시로 쓸 수 있는 플래그로, coturn이 내부망(loopback 등)으로 릴레이하지 못하게 막는 기본 보호를 무력화합니다.

## 다음 단계 제안

1. 참가자가 많아질 때를 대비해 mediasoup 같은 SFU로 전환 (현재는 참가자 쌍마다 P2P/TURN 연결이라 근접 인원이 많아지면 업링크 부하 증가)
2. 맵 데이터를 JSON 파일 업로드/에디터로 관리 (타일/오브젝트 배치 UI)
3. 오브젝트 상호작용 이벤트(키 입력 시 URL 팝업, iframe 임베드 등) 추가
4. Redis adapter로 Socket.IO 수평 확장 (다중 룸/다중 서버 인스턴스)
