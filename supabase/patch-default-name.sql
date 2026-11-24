-- Один раз в SQL Editor: новые пользователи больше не получают имя «Даша».
-- Имя задаёт админ в приложении. До правки в профиле — часть почты до @.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    case
      when coalesce(new.email, '') ilike 'admin@%' then 'Админ'
      when nullif(split_part(coalesce(new.email, ''), '@', 1), '') is not null
        then split_part(new.email, '@', 1)
      else 'Пользователь'
    end,
    case
      when coalesce(new.email, '') ilike 'admin@%' then 'admin'
      else 'user'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
