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
  - 시그널링(offer/answer/ICE candidate)은 Socket.IO로 중계, 실제 미디어는 P2P(WebRTC)로 직접 전송
  - 화면 상단 비디오 바에 내 화면 + 근처 참가자 화면 타일 표시, 마이크/카메라 개별 on-off 토글
  - 카메라/마이크 권한이 없어도 게임 자체는 정상 동작 (수신만 되거나 완전히 비활성)

## 포함되지 않은 것 (다음 단계)

- 웹 기반 맵 에디터
- ZEP Script 같은 커스텀 스크립팅 API
- 채팅(텍스트), 미니게임, 오브젝트 상호작용
- TURN 서버 (대칭형 NAT 등 일부 네트워크 환경에서는 STUN만으로 P2P 연결이 안 될 수 있음)

## 구조

```
zep-mini-mvp/
├── server/   # Node.js + TypeScript + Express + Socket.IO
│             # 권위 서버: 이동 검증/브로드캐스트, 근접 판정, WebRTC 시그널링 중계
└── client/   # Vite + TypeScript + Phaser 3
              # 타일맵 렌더링, 입력, 아바타, WebRTC 화상채팅(webrtc.ts, videoChat.ts)
```

## 실행 방법

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

브라우저 탭을 여러 개 열어 각각 다른 닉네임으로 접속하면 서로의 아바타가 실시간으로 움직이는 것을 확인할 수 있습니다. 아바타를 서로 가까이 이동시키면 화면 상단에 화상채팅 타일이 자동으로 나타납니다 (카메라/마이크 권한 허용 필요).

### 3. (선택) 서버 단독 스모크 테스트

브라우저 없이 join/move/broadcast 플로우만 빠르게 검증하고 싶다면, 서버 실행 중에:

```bash
cd server
npm run smoke-test
```

## 다음 단계 제안

1. TURN 서버 추가 (예: coturn) — STUN만으로는 연결이 안 되는 네트워크 환경 대응
2. 참가자가 많아질 때를 대비해 mediasoup 같은 SFU로 전환 (현재는 참가자 쌍마다 P2P 연결이라 근접 인원이 많아지면 업링크 부하 증가)
3. 맵 데이터를 JSON 파일 업로드/에디터로 관리 (타일/오브젝트 배치 UI)
4. 오브젝트 상호작용 이벤트(키 입력 시 URL 팝업, iframe 임베드 등) 추가
5. Redis adapter로 Socket.IO 수평 확장 (다중 룸/다중 서버 인스턴스)
