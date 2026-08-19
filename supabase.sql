create table documents(id uuid primary key default gen_random_uuid(),file_name text,document_type text,created_at timestamp default now());
create table reviews(id uuid primary key default gen_random_uuid(),document_id uuid,score int,risk_level text,summary text,created_at timestamp default now());
create table review_errors(id uuid primary key default gen_random_uuid(),review_id uuid,error_type text,original_text text,suggestion text,severity text);
