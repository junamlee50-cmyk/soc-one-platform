# SOC ONE 실행 아키텍처

## 권장 서비스 계층
1. Public Web
2. Auth / SOC ID
3. Athlete & Academy
4. Competition Engine
5. Ranking Engine
6. Support / Sponsorship
7. Regional Governance
8. Media / Commerce
9. Talent / Pro Contracts
10. CEO / Finance Dashboard

## 핵심 엔터티
User, Role, Athlete, Academy, Coach, Region, CommitteeMember, Referee, Tournament, Division, Registration, Payment, WeighIn, Bracket, Match, Result, RankingPoint, Medal, Certificate, SupportApplication, SupportAward, TrainingPass, HostSettlement, Sponsor, Content, Product, Order, TalentContract, AuditLog.

## 권한
- PUBLIC
- MEMBER
- ATHLETE
- COACH
- ACADEMY_ADMIN
- COMMITTEE
- REFEREE
- STAFF
- FINANCE
- ADMIN
- CEO

## 필수 통제
- 모든 대진·결과·랭킹·지원·결제 수정 감사로그
- 역할기반 권한
- 관리자 MFA
- 개인정보 최소수집
- 미성년자 보호자 동의
- PG 카드정보 직접 저장 금지
- 정기 백업·복구 리허설

## 2026-11-05 구현된 저장계층

기존 정적 HTML·통합 API 6개·rewrite를 유지합니다. `apiHandler`가 HTTP방식·출처·JSON·캐시를 검사하고 PostgreSQL 사용 시 매 요청의 데이터 읽기를 일관된 스냅샷으로, 변경을 트랜잭션으로 감쌉니다. 성공 응답과 쿠키는 COMMIT 뒤에 전송합니다. 변경 요청은 DB advisory lock을 공유하므로 서버리스 인스턴스가 달라도 중복·정원·진출을 함께 보호합니다. 초기 방식은 전체 쓰기를 직렬화하며, 부하 검증 뒤 대회·부문 단위 잠금으로 세분화해야 합니다.

`SOC_DATA_BACKEND=postgres`와 `DATABASE_URL`을 SOC 전용 환경에 설정합니다. `node scripts/migrate.mjs`는 스키마만 만들고, `node scripts/restore-blob.mjs`는 무결성이 확인된 비공개 백업을 빈 DB로 원자적으로 복구합니다. 기존 Blob은 사진·문서와 백업 역할로 분리할 계획이며 실제 전환 전 읽기 오류를 숨기지 않습니다.

`db/schema.sql`은 장기 정규화 설계, `db/migrations/001_operational_records.sql`은 현재 실행 가능한 SOC ID 보존 이관 계층입니다. 후자는 JSONB 레코드에 고유제약·인덱스·트랜잭션을 적용하지만, 모든 도메인별 외래키·집계 최적화를 제공하는 것은 아닙니다.

로그인·가입 시도 제한은 PostgreSQL의 별도 autocommit 카운터를 사용합니다. 인증 실패로 본 요청이 롤백되어도 시도 횟수는 유지됩니다. 계정별 15분 창 제한이며, WAF/IP별 남용 제한·이메일 확인·관리자 MFA를 대신하지 않습니다.

결과 정정은 ADMIN/CEO만 사유와 후속경기 초기화 확인을 제출할 수 있습니다. 해당 경기부터 결승까지 의존 결과를 되돌리고 관련 점수·메달·기존 증명서를 동시에 무효화하며, 원본은 감사기록에 보관합니다. 후속 경기 결과는 정정 뒤 다시 입력합니다. PostgreSQL이 없으면 이 작업을 거부합니다.
