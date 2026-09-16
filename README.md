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

## 포함되지 않은 것 (다음 단계)

- 웹 기반 맵 에디터
- ZEP Script 같은 커스텀 스크립팅 API
- 미니게임, 오브젝트 상호작용(화이트보드/유튜브 임베드), 프라이빗 회의실
- 모더레이션(음소거/차단/신고), 아바타 커스터마이징

## 구조

```
zep-mini-mvp/
├── docker-compose.yml       # 로컬 개발용: coturn만 (STUN-only로도 동작하니 선택 사항)
├── docker-compose.prod.yml  # 실제 배포용: Caddy(TLS) + server + coturn(TLS) 전체 스택
├── turnserver.conf          # coturn 개발용 설정 (TLS 없음)
├── turnserver.prod.conf     # coturn 배포용 설정 (TLS, 넓은 릴레이 포트 범위)
├── deploy/                  # 배포 가이드, Caddyfile, systemd 유닛, certbot 갱신 훅
├── server/   # Node.js + TypeScript + Express + Socket.IO (+ Dockerfile)
│             # 권위 서버: 이동 검증/브로드캐스트, 근접 판정, 채팅/리액션 중계·검증,
│             # WebRTC 시그널링 중계, TURN 크리덴셜 발급
└── client/   # Vite + TypeScript + Phaser 3
              # 타일맵 렌더링, 입력, 아바타(scenes/GameScene.ts)
              # 화상채팅 + 공간음향 + 화면공유(webrtc.ts, videoChat.ts)
              # 텍스트 채팅(chat.ts), 모바일 터치 D-패드(touchControls.ts)
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

브라우저 탭을 여러 개 열어 각각 다른 닉네임으로 접속하면 서로의 아바타가 실시간으로 움직이는 것을 확인할 수 있습니다. 아바타를 서로 가까이 이동시키면 화면 상단에 화상채팅 타일이 자동으로 나타납니다 (카메라/마이크 권한 허용 필요). 우측 하단에서 텍스트 채팅, 숫자 1~6으로 리액션, 비디오 타일의 🖥️ 버튼으로 화면 공유를 사용할 수 있습니다.

### 4. (선택) 서버 단독 스모크 테스트

브라우저 없이 join/move/broadcast/근접/시그널링/iceServers/채팅/리액션 플로우를 빠르게 검증하고 싶다면, 서버 실행 중에:

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

ZEP/Gather/Topia/WorkAdventure 등 유사 플랫폼 벤치마크를 바탕으로 우선순위를 매긴 목록입니다 (텍스트 채팅·리액션·공간음향·모바일 조작·화면 공유는 구현 완료):

1. 오브젝트 상호작용(화이트보드/유튜브 임베드), 프라이빗 회의실(방음 구역) 추가
2. 맵 데이터를 JSON(Tiled) 업로드/에디터로 관리 (타일/오브젝트 배치 UI)
3. 최소 모더레이션: 로컬 음소거/차단, 신고 로그
4. 참가자가 많아질 때를 대비해 mediasoup 같은 SFU로 전환 (현재는 참가자 쌍마다 P2P/TURN 연결이라 근접 인원이 많아지면 업링크 부하 증가)
5. Redis adapter로 Socket.IO 수평 확장 (다중 룸/다중 서버 인스턴스)
6. ZEP Script 같은 커스텀 스크립팅 API (보안 샌드박싱 선행 필요)
7. CI에서 `docker build`(서버/Caddy 이미지)까지 자동 검증 (이 세션은 네트워크 정책상 Docker Hub pull이 막혀 있어 이미지 빌드 자체는 실행하지 못하고 설정 파일 레벨로만 검증함)
