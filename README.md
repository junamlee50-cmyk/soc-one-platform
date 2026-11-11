# SOC ONE Platform

**STATE OF CONTROL**의 글로벌 주짓수 연맹·대회·선수 생태계를 위한 통합 웹 플랫폼입니다.

## 핵심 구조
- 공개 브랜드 홈페이지
- SOC 선수 ID / MY SOC
- 아카데미·연맹 네트워크 / MY ACADEMY
- 지역위원 KPI / MY REGION
- 심판 시스템 / MY REFEREE
- 대회 접수·계체·대진·결과
- 공식 전적·메달·랭킹
- 선수지원·엘리트·프로 계약
- 국내외 훈련 네트워크
- SOC PRO NIGHT
- SOC MEDIA
- SOC GEAR
- CEO 운영 대시보드

## 현재 배포 범위
운영 기능을 연결하는 **검수 단계의 프로젝트**입니다. 계정·세션, 선수·아카데미, 수동 입금확인, 접수·QR·계체·대진·결과·시즌 랭킹, 지원신청·평가, 역할 및 감사기록 API가 있습니다. 기존 운영 데이터는 private Vercel Blob에 JSON 레코드로 저장합니다. 작업 브랜치에는 PostgreSQL 트랜잭션 저장계층을 추가했으며, 운영 DB 연결·이관은 별도입니다. `db/schema.sql`은 설계안이며 적용된 관계형 DB가 아닙니다.

서비스 프로젝트는 `soc-one-platform-live`, 기본 주소는 https://soc-one-platform-live.vercel.app 입니다. 소스 커밋과 실제 배포 커밋은 다를 수 있으며 `/api/health`의 `commit`과 Vercel 배포 기록을 대조해야 합니다. 배포 보호 설정은 유지합니다.

**정식 운영 완료로 분류하지 않습니다.** 현재 수납은 무통장입금 방식이며 PG는 후속 선택사항입니다. 운영 DB 연결·이관, 본인/이메일 확인·계정복구, 추가인증의 배포 검수, 미성년자 동의·실운영 약관 등 남은 조건은 [운영 인수인계](docs/STATUS.md)를 참고하십시오.

## 검증
```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run validate
```
검증은 6개 API와 HTML 내 스크립트, 격리된 인증·권한·접수·결과·랭킹 흐름을 검사합니다. 로컬 SQL은 PGlite, CI는 PostgreSQL 17로 동시가입·마지막정원·중복결과·장애롤백·결과정정·백업복구를 실행합니다. `npm run test:browser`는 테스트용 HTTPS 인증서 경로를 설정한 격리 환경에서 Chromium으로 가입·로그인·다른 브라우저 기록 유지·관리자 폼·캐시·오프라인 실패를 검증합니다. 운영 DB 부하와 실제 휴대폰 카메라·PWA 설치 검수는 별도입니다.

## 운영 원칙
1. 랭킹과 선수후원 선정은 분리
2. 회원·아카데미 기본 가입비 0원 정책
3. 선수지원은 예산·정원·정량평가 기반
4. 대회 데이터가 선수·아카데미·지역 KPI로 자동 연결
5. 글로벌 확장을 고려한 SOC ID와 역할기반 권한 구조
