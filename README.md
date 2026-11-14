# نظام إدارة الدواجن: الواجهة (المرحلة 2)

الواجهة ثابتة (HTML/CSS/JS) وتُنشر على GitHub Pages، وتتصل بمشروع Supabase **poultry-erp** فقط.

## ما يحتويه المستودع

- `index.html`: الهيكل الرئيسي، RTL، مناسب للهاتف أولاً.
- `css/style.css`: ألوان كحلي وذهبي.
- `js/config.js`: رابط المشروع والمفتاح العام فقط.
- `js/app.js`: تسجيل الدخول، الصلاحيات، إدارة المستخدمين، الأدوار، تصنيفات الطيور.

لا يوجد في المستودع أي مفتاح `service_role` أو كلمة مرور أو سر.

## إعداد Supabase (مرة واحدة)

1. **إيقاف التسجيل العام**: من Authentication ← Providers ← Email، أوقف خيار "Allow new users to sign up". المستخدمون يُنشأون من شاشة المستخدمين فقط.
2. **إنشاء أول مالك** (مرة واحدة فقط): من Authentication ← Users ← Add user، أنشئ حساب المالك بالبريد وكلمة المرور، ثم شغّل في SQL Editor (استبدل البريد بالبريد الفعلي للمالك فقط):

   ```sql
   -- يعمل فقط إذا لم يوجد مالك بعد، ويمنح الدور لحساب واحد مؤكَّد البريد
   do $$
   declare v_count int;
   begin
     if exists (select 1 from public.profiles where role_code = 'owner') then
       raise exception 'يوجد مالك بالفعل. لا تكرر هذا الأمر.';
     end if;
     insert into public.profiles (id, full_name, role_code)
     select u.id, 'اسم المالك', 'owner'
     from auth.users u
     where lower(u.email) = lower('owner@example.com')
       and u.email_confirmed_at is not null;
     get diagnostics v_count = row_count;
     if v_count <> 1 then
       raise exception 'لم يُعثر على حساب مؤكَّد واحد بهذا البريد (عدد النتائج: %). لم يُمنح أي دور.', v_count;
     end if;
   end $$;
   ```

   إن ظهر خطأ فلن يُمنح أي دور. أي حساب آخر ينشئه المالك لاحقاً يُضاف من شاشة المستخدمين، لا من هذا الأمر.

3. **دالة إنشاء المستخدمين** `admin-users` منشورة بالفعل. تستخدم مفتاح الخدمة داخل Supabase نفسها ولا يصل إلى المتصفح.

## النشر على GitHub Pages

1. أنشئ مستودعاً خاصاً (Private) وارفع محتويات هذا المجلد إلى الفرع `main` في جذره.
2. من Settings ← Pages اختر Source: Deploy from a branch، والفرع `main` والمجلد `/ (root)`.
3. بعد ظهور الرابط، أضفه في Supabase ← Authentication ← URL Configuration (Site URL / Redirect URLs).

## ملاحظات أمنية

- الصلاحيات الحقيقية تُطبَّق في قاعدة البيانات عبر RLS، وليس بإخفاء الأزرار في الواجهة.
- المستخدم المعطّل يفقد الوصول فوراً لأن RLS يتحقق من `is_active` في كل طلب.
- لا يمكن تعطيل آخر مالك نشط أو تنزيل رتبته (قيد في قاعدة البيانات).
- مفتاح الواجهة هو المفتاح العام (publishable) فقط، وهو آمن للمتصفح بشرط تفعيل RLS، وقد فُعّل على كل الجداول.

## المكتبة

الواجهة تحمّل `@supabase/supabase-js@2.45.4` من jsDelivr. إن أردت تحديثها، ثبّت النسخة نفسها بعد مراجعتها.
