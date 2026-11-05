-- SOC ONE PostgreSQL baseline schema
-- Designed for global federation, competition, ranking, athlete support and auditability.

create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  soc_id varchar(24) unique not null,
  email varchar(255) unique,
  phone varchar(40),
  display_name varchar(80) not null,
  country_code char(2) default 'KR',
  locale varchar(10) default 'ko-KR',
  birth_date date,
  guardian_required boolean default false,
  status varchar(20) not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table roles (
  id bigserial primary key,
  code varchar(40) unique not null
);

insert into roles(code) values
('MEMBER'),('ATHLETE'),('COACH'),('ACADEMY_ADMIN'),('COMMITTEE'),('REFEREE'),('STAFF'),('FINANCE'),('ADMIN'),('CEO')
on conflict do nothing;

create table user_roles (
  user_id uuid references users(id) on delete cascade,
  role_id bigint references roles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key(user_id, role_id)
);

create table regions (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null,
  name varchar(100) not null,
  parent_id uuid references regions(id),
  active boolean default true
);

create table academies (
  id uuid primary key default gen_random_uuid(),
  region_id uuid references regions(id),
  name varchar(160) not null,
  slug varchar(180) unique not null,
  owner_user_id uuid references users(id),
  address text,
  phone varchar(40),
  website text,
  instagram text,
  verified boolean default false,
  active boolean default true,
  joined_at timestamptz default now()
);

create table academy_members (
  academy_id uuid references academies(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  member_type varchar(30) not null default 'ATHLETE',
  joined_at timestamptz default now(),
  left_at timestamptz,
  primary key(academy_id,user_id,joined_at)
);

create table athletes (
  user_id uuid primary key references users(id) on delete cascade,
  academy_id uuid references academies(id),
  belt varchar(20),
  gender varchar(20),
  default_weight_kg numeric(6,2),
  athlete_status varchar(30) default 'REGISTERED',
  verified_at timestamptz,
  created_at timestamptz default now()
);

create table tournaments (
  id uuid primary key default gen_random_uuid(),
  name varchar(180) not null,
  slug varchar(200) unique not null,
  level varchar(30) not null,
  country_code char(2) not null default 'KR',
  region_id uuid references regions(id),
  venue_name varchar(180),
  venue_address text,
  start_at timestamptz,
  registration_open_at timestamptz,
  registration_close_at timestamptz,
  status varchar(30) not null default 'DRAFT',
  ranking_multiplier numeric(5,2) not null default 1.0,
  created_at timestamptz default now()
);

create table divisions (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references tournaments(id) on delete cascade,
  discipline varchar(20) not null,
  age_group varchar(30) not null,
  gender varchar(20),
  belt_min varchar(20),
  belt_max varchar(20),
  weight_limit_kg numeric(6,2),
  absolute boolean default false,
  capacity integer,
  fee_krw integer
);

create table registrations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references tournaments(id) on delete cascade,
  division_id uuid references divisions(id),
  athlete_user_id uuid references users(id),
  academy_id uuid references academies(id),
  status varchar(30) not null default 'PENDING',
  payment_status varchar(30) not null default 'UNPAID',
  amount_krw integer not null default 0,
  registered_at timestamptz default now(),
  unique(tournament_id,division_id,athlete_user_id)
);

create table weigh_ins (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid references registrations(id) on delete cascade,
  weight_kg numeric(6,2) not null,
  passed boolean not null,
  measured_by uuid references users(id),
  measured_at timestamptz default now()
);

create table brackets (
  id uuid primary key default gen_random_uuid(),
  division_id uuid references divisions(id) on delete cascade,
  version integer not null default 1,
  published boolean default false,
  created_by uuid references users(id),
  created_at timestamptz default now()
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  bracket_id uuid references brackets(id) on delete cascade,
  round_no integer not null,
  mat_no integer,
  sequence_no integer,
  athlete_a uuid references users(id),
  athlete_b uuid references users(id),
  winner_user_id uuid references users(id),
  win_method varchar(40),
  score_a varchar(40),
  score_b varchar(40),
  duration_seconds integer,
  status varchar(30) default 'SCHEDULED',
  started_at timestamptz,
  ended_at timestamptz
);

create table medals (
  id uuid primary key default gen_random_uuid(),
  division_id uuid references divisions(id),
  athlete_user_id uuid references users(id),
  medal varchar(10) not null,
  awarded_at timestamptz default now()
);

create table ranking_events (
  id uuid primary key default gen_random_uuid(),
  athlete_user_id uuid references users(id),
  tournament_id uuid references tournaments(id),
  division_id uuid references divisions(id),
  base_points numeric(8,2) not null,
  multiplier numeric(5,2) not null default 1,
  bracket_factor numeric(5,2) not null default 1,
  final_points numeric(8,2) not null,
  reason varchar(80) not null,
  created_at timestamptz default now()
);

create table ranking_snapshots (
  id uuid primary key default gen_random_uuid(),
  season varchar(20) not null,
  athlete_user_id uuid references users(id),
  discipline varchar(20),
  gender varchar(20),
  belt varchar(20),
  weight_class varchar(40),
  points numeric(10,2) not null default 0,
  rank integer,
  calculated_at timestamptz not null default now()
);

create table support_programs (
  id uuid primary key default gen_random_uuid(),
  season varchar(20) not null,
  tier varchar(30) not null,
  quota integer not null,
  budget_krw bigint not null,
  status varchar(20) default 'DRAFT'
);

create table support_scores (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references support_programs(id),
  athlete_user_id uuid references users(id),
  competition_score numeric(5,2) default 0,
  external_score numeric(5,2) default 0,
  growth_score numeric(5,2) default 0,
  activity_score numeric(5,2) default 0,
  compliance_score numeric(5,2) default 0,
  media_score numeric(5,2) default 0,
  total_score numeric(5,2) generated always as
    (competition_score+external_score+growth_score+activity_score+compliance_score+media_score) stored,
  selected boolean default false,
  decided_at timestamptz
);

create table regional_kpi_snapshots (
  id uuid primary key default gen_random_uuid(),
  region_id uuid references regions(id),
  committee_user_id uuid references users(id),
  period varchar(20) not null,
  new_academies numeric(5,2) default 0,
  retention numeric(5,2) default 0,
  tournament_academies numeric(5,2) default 0,
  athlete_growth numeric(5,2) default 0,
  education_events numeric(5,2) default 0,
  meeting_attendance numeric(5,2) default 0,
  member_activation numeric(5,2) default 0,
  admin_compliance numeric(5,2) default 0,
  deduction numeric(5,2) default 0,
  total numeric(6,2),
  calculated_at timestamptz default now()
);

create table training_pass_usage (
  id uuid primary key default gen_random_uuid(),
  athlete_user_id uuid references users(id),
  host_academy_id uuid references academies(id),
  visit_date date not null,
  pass_tier varchar(30) not null,
  settlement_amount numeric(12,2) default 0,
  settlement_currency char(3) default 'KRW',
  status varchar(20) default 'USED'
);

create table sponsors (
  id uuid primary key default gen_random_uuid(),
  name varchar(180) not null,
  status varchar(30) default 'LEAD',
  contact_name varchar(80),
  contract_value numeric(14,2),
  currency char(3) default 'KRW',
  contract_start date,
  contract_end date
);

create table audit_logs (
  id bigserial primary key,
  actor_user_id uuid references users(id),
  action varchar(80) not null,
  entity_type varchar(60) not null,
  entity_id varchar(80) not null,
  before_json jsonb,
  after_json jsonb,
  request_id varchar(120),
  created_at timestamptz not null default now()
);

create index idx_tournaments_start on tournaments(start_at);
create index idx_registrations_athlete on registrations(athlete_user_id);
create index idx_matches_athlete_a on matches(athlete_a);
create index idx_matches_athlete_b on matches(athlete_b);
create index idx_ranking_events_athlete on ranking_events(athlete_user_id);
create index idx_audit_entity on audit_logs(entity_type,entity_id);
