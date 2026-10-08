-- 27-seat.sql  座位编排
create table if not exists public.seat_grid (
  id bigserial primary key,
  class text not null,
  seat_row int not null,      -- 0~6（7排）
  seat_col int not null,      -- 0~5（6列）
  student_name text not null,
  unique (class, seat_row, seat_col)
);
alter table public.seat_grid enable row level security;
create policy "anon读写座位表" on public.seat_grid for all using (true) with check (true);
