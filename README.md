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
- `PAYMENT_PROVIDER`: `mock` 또는 `toss`
- `TOSS_CLIENT_KEY`: 토스 클라이언트 키
- `TOSS_SECRET_KEY`: 토스 시크릿 키
- `TOSS_API_BASE_URL`: 토스 API 엔드포인트

## 배포 체크리스트

1. `npm install --omit=dev`
2. `APP_BASE_URL`를 실제 도메인으로 설정
3. 운영 환경에서는 `PAYMENT_PROVIDER=mock` 대신 실제 PG 설정 사용
4. `/api/health` 응답 확인
5. `data/`, `public/uploads/`는 서버 쓰기 권한이 있어야 함
6. 리버스 프록시(Nginx, Railway, Render 등) 사용 시 필요하면 `TRUST_PROXY=1` 설정

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
