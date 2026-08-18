create table if not exists AI_PROCESS_LOG(
 id uuid default gen_random_uuid() primary key,
 document_id text,
 segment_id text,
 stage text,
 model text,
 error_type text,
 error_message text,
 duration_ms integer,
 retry_count integer default 0,
 created_at timestamptz default now()
);
