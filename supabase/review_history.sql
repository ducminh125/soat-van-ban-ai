create table if not exists review_history (
  id text primary key,
  filename text not null,
  created_at timestamptz not null,
  total_issues integer not null default 0,
  resolved_issues integer not null default 0,
  pending_issues integer not null default 0,
  issues jsonb not null default '[]'::jsonb
);

create index if not exists review_history_created_at_idx
on review_history(created_at desc);
