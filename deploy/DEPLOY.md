# 실제 배포 가이드

`docker-compose.prod.yml` 하나로 3개 컨테이너(Caddy + 서버 + coturn)를 VPS 한 대에 올리는 구성입니다.

```
인터넷 ── 443/80 ──▶ Caddy (TLS 자동 발급, 정적 클라이언트 서빙, /socket.io → server 프록시)
                          │
                          └──▶ server (Socket.IO, 내부 전용, 외부 미노출)

인터넷 ── 3478/5349 (+relay UDP) ──▶ coturn (host network, 자체 TLS)
```

Caddy와 server는 도커 브리지 네트워크로만 통신하므로 클라이언트-서버가 같은 오리진(HTTPS 도메인)이 되어 CORS 걱정이 없습니다. coturn은 NAT 트래버설 특성상 host network를 사용합니다.

## 0. 사전 준비물

- Ubuntu 22.04/24.04 등 리눅스 VPS 1대, Docker Engine + Docker Compose plugin 설치됨
- 도메인 2개(또는 서브도메인 2개), 둘 다 이 VPS의 공인 IP로 A 레코드 지정
  - 앱 도메인: 예) `app.example.com`
  - TURN 도메인: 예) `turn.example.com`
- 방화벽에서 열어야 하는 포트
  - `80/tcp`, `443/tcp` — Caddy (HTTP→HTTPS 리다이렉트 + ACME + 앱)
  - `3478/udp`, `3478/tcp` — TURN
  - `5349/tcp`, `5349/udp` — TURNS (TLS/DTLS)
  - `49152-49452/udp` — TURN 릴레이 포트 범위 (`turnserver.prod.conf`의 `min-port`/`max-port`와 반드시 일치시킬 것)

## 1. 저장소 배치

```bash
sudo mkdir -p /opt/zep-mini-mvp
sudo git clone https://github.com/v-0-0-v/devAI-toyproject.git /opt/zep-mini-mvp
cd /opt/zep-mini-mvp
```

## 2. 환경변수 설정

```bash
cp server/.env.production.example server/.env.production
```

`server/.env.production`을 열어 다음을 채웁니다:

| 변수 | 값 |
|---|---|
| `APP_DOMAIN` | 앱 도메인 (예: `app.example.com`) |
| `CLIENT_ORIGIN` | `https://` + 앱 도메인 |
| `ACME_EMAIL` | Let's Encrypt 알림 받을 이메일 |
| `TURN_DOMAIN` | TURN 도메인 (예: `turn.example.com`) |
| `TURN_SECRET` | `openssl rand -hex 32` 로 생성한 강력한 랜덤값 |
| `TURN_URLS` | 기본값 그대로 두되 도메인만 실제 값으로 교체 |

## 3. TURN 도메인용 TLS 인증서 발급 (certbot)

coturn은 Caddy처럼 인증서를 자동 발급하지 않으므로, 별도로 certbot을 host(컨테이너 밖)에 설치해 발급합니다. **이 시점엔 아직 아무것도 80번 포트를 쓰고 있지 않아야** `--standalone` 모드가 동작합니다 (Caddy는 아직 시작 전).

```bash
sudo apt-get update && sudo apt-get install -y certbot
sudo certbot certonly --standalone -d turn.example.com \
  --non-interactive --agree-tos -m you@example.com
```

발급된 인증서는 `/etc/letsencrypt/live/turn.example.com/{fullchain,privkey}.pem`에 저장되고, `docker-compose.prod.yml`이 이 경로 전체(`/etc/letsencrypt`)를 coturn 컨테이너에 읽기 전용으로 마운트합니다.

### 갱신 시 coturn 자동 재시작

coturn은 인증서를 실시간으로 다시 읽지 않으므로, certbot이 갱신할 때마다 coturn을 재시작해야 합니다:

```bash
sudo cp deploy/certbot-renewal-hook.sh /etc/letsencrypt/renewal-hooks/deploy/restart-coturn.sh
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/restart-coturn.sh
```

certbot은 보통 systemd timer(`certbot.timer`)로 하루 2회 자동 갱신을 시도합니다 (`systemctl list-timers | grep certbot`으로 확인). 갱신 테스트: `sudo certbot renew --dry-run`.

## 4. 스택 기동

```bash
cd /opt/zep-mini-mvp
sudo docker compose -f docker-compose.prod.yml --env-file server/.env.production up -d --build
```

Caddy는 첫 기동 시 `APP_DOMAIN`에 대한 TLS 인증서를 자동으로 발급받습니다(80/443 포트를 통한 ACME HTTP-01 challenge). 로그로 확인:

```bash
sudo docker compose -f docker-compose.prod.yml logs -f caddy
```

`https://app.example.com` 접속해서 로그인 화면이 뜨는지, 서버 로그(`docker compose ... logs -f server`)에 접속 이벤트가 찍히는지 확인합니다.

## 5. 부팅 시 자동 시작 (systemd, 선택)

각 컨테이너는 이미 `restart: unless-stopped`이지만, "스택"을 하나의 서비스로 다루고 싶다면:

```bash
sudo cp deploy/zep-mini-mvp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now zep-mini-mvp
```

`systemctl status zep-mini-mvp`로 상태 확인, `systemctl stop/start zep-mini-mvp`로 전체 스택 제어가 가능합니다.

## 6. 업데이트 배포

```bash
cd /opt/zep-mini-mvp
git pull
sudo docker compose -f docker-compose.prod.yml --env-file server/.env.production up -d --build
```

## 7. 트러블슈팅

- **Caddy가 인증서 발급에 실패한다**: `APP_DOMAIN`의 DNS가 이 서버를 가리키는지(`dig app.example.com`), 80/443이 방화벽/클라우드 보안그룹에서 열려 있는지 확인.
- **화상채팅은 되는데 다른 네트워크에서 안 된다**: coturn 로그(`docker compose logs coturn`)에서 `CREATE_PERMISSION` 오류 확인. `TURN_URLS`의 도메인이 실제 발급받은 `TURN_DOMAIN`과 일치하는지, 방화벽에 릴레이 포트 범위가 열려 있는지 확인.
- **coturn이 아예 안 뜬다**: `docker compose logs coturn`에서 인증서 경로 오류 확인 — 3단계의 certbot 발급이 `TURN_DOMAIN` 값과 정확히 일치하는 도메인으로 되어 있어야 합니다.
- **동시 통화가 많아지면 화상채팅이 끊긴다**: `turnserver.prod.conf`의 `min-port`/`max-port` 범위를 넓히고, 방화벽/보안그룹의 UDP 범위도 함께 넓히세요 (통화 세션 하나당 릴레이 포트 1개 소모).

## 로컬에서 이 구성을 미리 점검하는 법 (도메인 없이)

- `docker compose -f docker-compose.prod.yml --env-file server/.env.production config` — YAML/환경변수 치환이 올바른지 확인 (이미지 pull 불필요)
- `caddy validate --config deploy/Caddyfile --adapter caddyfile` — Caddyfile 문법 확인 (caddy 바이너리 필요: `apt install caddy`)
- `systemd-analyze verify deploy/zep-mini-mvp.service` — systemd 유닛 문법 확인
