-- VendorBooks does not insert demo rows here.
-- Local `npm run dev` without Supabase keys loads the Harbor & Pine sample
-- mall automatically. After you create a real project, mark the founder admin:
--
--   update public.profiles
--   set is_platform_admin = true
--   where email = 'mark@yourdomain.com';
--
-- The signup path also honors PLATFORM_ADMIN_EMAILS on the server.
select 1;
