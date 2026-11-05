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
