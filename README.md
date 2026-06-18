# Challenge Manager Platform

문서 기반 MVP에서 출발해 실제 로컬 서버와 SQLite DB를 붙인 챌린지 매니저 플랫폼 초기 버전입니다.

## 포함된 범위

- 참가자 모드
  - 챌린지 탐색
  - 챌린지 상세
  - 챌린지 참가
  - 내 챌린지 상태 확인
  - 인증 제출
  - 랭킹 확인
  - 마이페이지
  - 반려/결과 이의제기
- 운영자 모드
  - 대시보드
  - 챌린지 개설
  - 검수 큐
  - 공지 관리
  - 정산 미리보기/확정
- 관리자 모드
  - 관리자 대시보드
  - 정산 승인
  - 분쟁/이의제기 답변

## 로컬 실행 방법

1. `cmd /c npm.cmd install`
2. `cmd /c npm.cmd run dev`
3. 브라우저에서 `http://127.0.0.1:4175/` 접속

## 배포용 환경 변수

`.env.example` 기준으로 아래 값을 설정하면 됩니다.

- `HOST`: 서버 바인딩 주소, 배포 환경에서는 기본값 `0.0.0.0` 사용
- `PORT`: 서버 포트
- `APP_BASE_URL`: 외부에서 접근하는 실제 서비스 URL
- `TRUST_PROXY`: 리버스 프록시 환경이면 `1`
- `NODE_ENV`: 운영 환경이면 `production`
- `ENABLE_DEMO_SEED`: 데모 계정/샘플 챌린지 자동 생성 여부
- `BOOTSTRAP_ADMIN_NAME`: 최초 관리자 이름
- `BOOTSTRAP_ADMIN_EMAIL`: 최초 관리자 이메일
- `BOOTSTRAP_ADMIN_PASSWORD`: 최초 관리자 비밀번호
- `PAYMENT_PROVIDER`: `mock` 또는 `toss`
- `TOSS_CLIENT_KEY`: 토스 클라이언트 키
- `TOSS_SECRET_KEY`: 토스 시크릿 키
- `TOSS_API_BASE_URL`: 토스 API 엔드포인트

## Railway 배포

Railway 공식 문서 기준으로 `railway.toml`에서 빌드/시작/헬스체크 설정을 코드로 관리할 수 있으므로, 이 저장소는 [`railway.toml`](/C:/Users/user/OneDrive/문서/New%20project6-10/railway.toml:1)을 포함해 바로 배포할 수 있게 구성했습니다.

### Railway에서 설정할 것

1. GitHub 저장소 연결
2. Root Directory는 비워두기
3. 환경 변수 입력
4. 최초 배포 후 `/api/health` 성공 확인

### Railway 권장 환경 변수

- `HOST=0.0.0.0`
- `NODE_ENV=production`
- `ENABLE_DEMO_SEED=false`
- `APP_BASE_URL=https://실제-railway-도메인`
- `TRUST_PROXY=1`
- `BOOTSTRAP_ADMIN_NAME=Platform Admin`
- `BOOTSTRAP_ADMIN_EMAIL=admin@example.com`
- `BOOTSTRAP_ADMIN_PASSWORD=영문숫자포함8자이상`
- `PAYMENT_PROVIDER=mock`

실제 결제 연동 시에는 아래도 추가합니다.

- `TOSS_CLIENT_KEY`
- `TOSS_SECRET_KEY`
- `TOSS_API_BASE_URL=https://api.tosspayments.com`

### Railway 배포 동작

- 빌드: Railway Railpack이 `package.json`과 `package-lock.json`을 기준으로 자동 설치
- 시작 명령: `npm start`
- 헬스체크: `/api/health`
- 재시작 정책: 실패 시 자동 재시도 3회

### 주의 사항

- `data/`와 `public/uploads/`는 컨테이너 로컬 저장소이므로 재배포 시 영속성이 없습니다.
- 지금 구조는 SQLite + 로컬 업로드 기반이라, 실제 운영 단계에서는 Railway Volume 또는 외부 스토리지/S3, 외부 DB 이전이 필요합니다.
- `APP_BASE_URL`을 실제 Railway 도메인으로 넣지 않으면 결제 콜백 URL과 외부 링크 계산이 잘못될 수 있습니다.
- 운영 배포에서는 `ENABLE_DEMO_SEED=false`를 권장합니다. 대신 `BOOTSTRAP_ADMIN_*` 환경 변수로 최초 관리자 1개를 생성할 수 있습니다.

## 운영 실행

- 시작: `npm start`
- 헬스체크: `GET /api/health`

## 데모 계정

- 참가자: `participant@example.com` / `demo1234`
- 운영자: `organizer@example.com` / `demo1234`
- 관리자: `admin@example.com` / `demo1234`

## 구현 메모

- 백엔드: `Node + Express`
- DB: `SQLite (better-sqlite3)`
- 프론트엔드: 정적 HTML/CSS/JS + REST API 연동
- 인증: 세션 토큰 기반 로그인 + `scrypt` 비밀번호 해시 + 세션 만료 처리
- 계정 기능: 회원가입, 비밀번호 변경, 로그인 시도 제한(15분 창 기준)
- 파일 업로드: `multer` 기반 로컬 업로드
- 결제/정산: 결제 대기 -> 결제 완료 -> 환불 상태 관리, 정산 확정 시 지급 레코드 생성
- PG 구조: `src/payment-gateway.js` 어댑터 계층 분리, 현재 `mock` provider 사용
- 정산/지급은 실제 PG/송금 연동 전 단계의 서버 시뮬레이션
- 운영자 확정 -> 관리자 승인 -> 지급 완료 흐름 포함
- 운영자는 본인이 소유한 챌린지만 관리 가능
- 참가자/운영자/관리자별 수익화 지표와 지갑 요약 제공
- 서버는 `SIGINT`, `SIGTERM` 수신 시 정상 종료 처리

## 다음 단계 권장

1. 실제 결제 PG 및 환불 API 연동
2. 실제 출금/정산 계좌 연동과 세무 증빙 처리
3. 실제 파일 스토리지 분리(S3 등)
4. 테스트 코드와 역할별 E2E 시나리오 추가
5. 배포/모니터링/에러 추적 구성 추가
