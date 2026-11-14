(function () {
  'use strict';

  var cfg = window.APP_CONFIG;
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  var app = document.getElementById('app');
  var S = { session: null, profile: null, perms: new Set() };

  // الشاشات. التحقق الفعلي يتم في RLS، وإخفاء الروابط هنا تجميلي فقط.
  var ROUTES = [
    { id: 'home', title: 'الرئيسية', perm: null },
    { id: 'users', title: 'المستخدمون', perm: 'users.manage' },
    { id: 'roles', title: 'الأدوار والصلاحيات', perm: 'users.manage' },
    { id: 'classes', title: 'تصنيفات الطيور', perm: 'master.write' }
  ];

  // ---------- أدوات مساعدة ----------
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function can(p) { return S.perms.has(p); }
  function currentRoute() {
    var id = (location.hash || '#home').slice(1);
    return ROUTES.find(function (r) { return r.id === id; }) || ROUTES[0];
  }
  var toastTimer = null;
  function toast(msg, ok) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show ' + (ok === false ? 'err' : 'ok');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 3500);
  }
  // رسالة خطأ من دالة Edge (تأتي في جسم الاستجابة)
  function fnErrorMessage(error) {
    if (error && error.context && typeof error.context.json === 'function') {
      return error.context.json().then(function (b) { return b.error || error.message; })
        .catch(function () { return error.message; });
    }
    return Promise.resolve(error ? error.message : 'خطأ غير معروف');
  }

  // ---------- تحميل الجلسة والملف والصلاحيات ----------
  async function loadSession() {
    S.perms = new Set();
    S.profile = null;
    var res = await sb.auth.getSession();
    S.session = res.data.session;
    if (!S.session) return false;

    var prof = await sb.from('v_my_profile').select('id, full_name, role_code, role_name, is_active').maybeSingle();
    if (prof.error) throw prof.error;
    if (!prof.data || !prof.data.is_active) {
      await sb.auth.signOut();
      throw new Error('الحساب غير مسجّل أو غير مفعّل. تواصل مع مالك الشركة.');
    }
    S.profile = prof.data;

    var rp = await sb.from('role_permissions').select('permission_code').eq('role_code', prof.data.role_code);
    if (rp.error) throw rp.error;
    S.perms = new Set(rp.data.map(function (x) { return x.permission_code; }));
    return true;
  }

  // ---------- الشاشات ----------
  function renderLogin(message) {
    app.innerHTML =
      '<div class="login-wrap"><div class="login-box">' +
      '<h1>نظام إدارة الدواجن</h1>' +
      '<div class="sub">تسجيل الدخول</div>' +
      '<form id="loginForm" class="form">' +
      '<input name="email" type="email" placeholder="البريد الإلكتروني" autocomplete="username" dir="ltr" required>' +
      '<input name="password" type="password" placeholder="كلمة المرور" autocomplete="current-password" dir="ltr" required>' +
      '<button class="btn gold" type="submit">دخول</button>' +
      (message ? '<p class="msg-err">' + esc(message) + '</p>' : '') +
      '</form></div></div>';
  }

  function renderShell(route) {
    var nav = ROUTES.filter(function (r) { return !r.perm || can(r.perm); })
      .map(function (r) {
        return '<a href="#' + r.id + '" class="' + (r.id === route.id ? 'active' : '') + '">' + esc(r.title) + '</a>';
      }).join('');
    app.innerHTML =
      '<header class="top">' +
      '<div class="brand">شركة تجارة الدواجن</div>' +
      '<div class="me"><span>' + esc(S.profile.full_name) + ' · ' + esc(S.profile.role_name) + '</span>' +
      '<button class="btn ghost small" data-action="logout">خروج</button></div>' +
      '</header>' +
      '<nav class="nav">' + nav + '</nav>' +
      '<main><h1>' + esc(route.title) + '</h1><div id="content"><div class="loading">جارٍ التحميل...</div></div></main>';
  }

  async function render() {
    try {
      var ok = await loadSession();
      if (!ok) return renderLogin();
    } catch (e) {
      return renderLogin(e.message);
    }
    var route = currentRoute();
    renderShell(route);
    var el = document.getElementById('content');
    if (route.perm && !can(route.perm)) {
      el.innerHTML = '<div class="card err">لا تملك صلاحية عرض هذه الشاشة.</div>';
      return;
    }
    try {
      if (route.id === 'home') await pageHome(el);
      if (route.id === 'users') await pageUsers(el);
      if (route.id === 'roles') await pageRoles(el);
      if (route.id === 'classes') await pageClasses(el);
    } catch (e) {
      el.innerHTML = '<div class="card err">حدث خطأ: ' + esc(e.message) + '</div>';
    }
  }

  // الرئيسية: حالة المراحل وتغيير كلمة المرور الشخصية
  async function pageHome(el) {
    el.innerHTML =
      '<section class="card"><h2>مرحباً ' + esc(S.profile.full_name) + '</h2>' +
      '<p class="muted">دورك: ' + esc(S.profile.role_name) + '</p></section>' +
      '<section class="card"><h2>تغيير كلمة المرور</h2>' +
      '<form id="pwForm" class="form">' +
      '<input name="pw" type="password" placeholder="كلمة المرور الجديدة (10 أحرف على الأقل)" minlength="10" autocomplete="new-password" dir="ltr" required>' +
      '<input name="pw2" type="password" placeholder="تأكيد كلمة المرور" minlength="10" autocomplete="new-password" dir="ltr" required>' +
      '<button class="btn gold" type="submit">حفظ</button></form></section>' +
      '<section class="card"><h2>حالة النظام</h2>' +
      '<p>المرحلة 1: قاعدة البيانات والصلاحيات (RLS) والحسابات والتقارير: <span class="ok-mark">مكتملة</span></p>' +
      '<p>المرحلة 2: تسجيل الدخول وإدارة المستخدمين والصلاحيات: <span class="ok-mark">مكتملة</span></p>' +
      '<p class="muted">المراحل التالية (المزارع والحمولات، المسلخ والإنتاج، المخزون والمبيعات، المصروفات والتقارير) لم تُبنَ بعد.</p>' +
      '</section>';
  }

  // المستخدمون: إضافة، تغيير دور، تفعيل/تعطيل، تغيير كلمة المرور
  async function pageUsers(el) {
    var q1 = await sb.from('profiles').select('id, full_name, role_code, is_active, created_at').order('created_at');
    var q2 = await sb.from('roles').select('code, name_ar').order('code');
    if (q1.error) throw q1.error;
    if (q2.error) throw q2.error;
    var roles = q2.data;
    var roleOpts = function (sel) {
      return roles.map(function (r) {
        return '<option value="' + esc(r.code) + '"' + (r.code === sel ? ' selected' : '') + '>' + esc(r.name_ar) + '</option>';
      }).join('');
    };
    var rows = q1.data.map(function (u) {
      var me = u.id === S.session.user.id;
      return '<tr data-id="' + esc(u.id) + '">' +
        '<td>' + esc(u.full_name) + (me ? ' <small>(أنت)</small>' : '') + '</td>' +
        '<td><select data-action="set-role">' + roleOpts(u.role_code) + '</select></td>' +
        '<td>' + (u.is_active ? '<span class="ok-mark">مفعّل</span>' : '<span class="muted">معطّل</span>') + '</td>' +
        '<td><button class="btn small outline" data-action="toggle-user" data-active="' + (u.is_active ? 'true' : 'false') + '">' +
          (u.is_active ? 'تعطيل' : 'تفعيل') + '</button> ' +
        '<button class="btn small" data-action="reset-pw">كلمة المرور</button></td>' +
        '</tr>';
    }).join('');

    el.innerHTML =
      '<section class="card"><h2>إضافة مستخدم</h2>' +
      '<form id="addUser" class="form">' +
      '<input name="full_name" placeholder="الاسم الكامل" required>' +
      '<input name="email" type="email" placeholder="البريد الإلكتروني" dir="ltr" required>' +
      '<input name="password" type="password" placeholder="كلمة مرور مؤقتة (10 أحرف على الأقل)" minlength="10" dir="ltr" required>' +
      '<select name="role_code">' + roleOpts('warehouse') + '</select>' +
      '<button class="btn gold" type="submit">إنشاء المستخدم</button>' +
      '<p class="muted">يُنشأ الحساب مفعّلاً مباشرة. أعطِ المستخدم كلمة المرور المؤقتة وليغيّرها من شاشة الرئيسية.</p>' +
      '</form></section>' +
      '<section class="card"><h2>المستخدمون (' + q1.data.length + ')</h2>' +
      '<div class="table-wrap"><table><thead><tr><th>الاسم</th><th>الدور</th><th>الحالة</th><th>إجراءات</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></section>';
  }

  // الأدوار والصلاحيات: عرض فقط
  async function pageRoles(el) {
    var a = await sb.from('roles').select('code, name_ar').order('code');
    var b = await sb.from('permissions').select('code, name_ar').order('code');
    var c = await sb.from('role_permissions').select('role_code, permission_code');
    if (a.error) throw a.error;
    if (b.error) throw b.error;
    if (c.error) throw c.error;
    var has = {};
    c.data.forEach(function (x) { has[x.role_code + '|' + x.permission_code] = true; });

    var head = '<th>الصلاحية</th>' + a.data.map(function (r) { return '<th>' + esc(r.name_ar) + '</th>'; }).join('');
    var body = b.data.map(function (p) {
      return '<tr><td>' + esc(p.name_ar) + '<br><small dir="ltr">' + esc(p.code) + '</small></td>' +
        a.data.map(function (r) {
          return '<td class="' + (has[r.code + '|' + p.code] ? 'ok-mark' : 'no-mark') + '">' +
            (has[r.code + '|' + p.code] ? '✓' : '—') + '</td>';
        }).join('') + '</tr>';
    }).join('');

    el.innerHTML =
      '<section class="card"><p class="muted">مصفوفة الصلاحيات الحالية. التعديل يتم من قاعدة البيانات بإشراف المطوّر، وليس من الواجهة.</p>' +
      '<div class="table-wrap"><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div></section>';
  }

  // تصنيفات الطيور: قابل للبيع / غير قابل / غير محدد
  async function pageClasses(el) {
    var q = await sb.from('bird_classes').select('code, name_ar, is_sellable, notes').order('code');
    if (q.error) throw q.error;
    var val = function (v) { return v === true ? 'true' : v === false ? 'false' : 'null'; };
    var rows = q.data.map(function (c) {
      return '<tr><td>' + esc(c.name_ar) + '<br><small dir="ltr">' + esc(c.code) + '</small></td>' +
        '<td><select data-action="set-sellable" data-code="' + esc(c.code) + '">' +
          '<option value="true"' + (val(c.is_sellable) === 'true' ? ' selected' : '') + '>قابل للبيع</option>' +
          '<option value="false"' + (val(c.is_sellable) === 'false' ? ' selected' : '') + '>غير قابل للبيع</option>' +
          '<option value="null"' + (val(c.is_sellable) === 'null' ? ' selected' : '') + '>غير محدد</option>' +
        '</select></td>' +
        '<td><small>' + esc(c.notes || '') + '</small></td></tr>';
    }).join('');
    el.innerHTML =
      '<section class="card"><p class="muted">القابل للبيع يدخل المخزون المتاح للبيع. «غير محدد» لا يدخل المخزون المتاح حتى يُعتمد. التغيير يسري على التشغيلات التي تُرحَّل بعد التعديل.</p>' +
      '<div class="table-wrap"><table><thead><tr><th>التصنيف</th><th>صلاحية البيع</th><th>ملاحظة</th></tr></thead><tbody>' + rows + '</tbody></table></div></section>';
  }

  // ---------- الأحداث (مفوّضة من الحاوية الرئيسية) ----------
  app.addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;
    if (action === 'logout') { await sb.auth.signOut(); return; }

    var row = btn.closest('[data-id]');
    var id = row ? row.dataset.id : null;

    if (action === 'toggle-user') {
      var active = btn.dataset.active === 'true';
      if (id === S.session.user.id && active &&
          !confirm('ستفقد وصولك إلى النظام بعد التعطيل. هل تريد المتابعة؟')) return;
      btn.disabled = true;
      var up = await sb.from('profiles').update({ is_active: !active }).eq('id', id).select('id');
      btn.disabled = false;
      if (up.error) return toast(up.error.message, false);
      if (!up.data || up.data.length === 0) return toast('لا تملك صلاحية تعديل هذا المستخدم', false);
      toast('تم تحديث الحالة');
      return render();
    }

    if (action === 'reset-pw') {
      var pw = prompt('كلمة المرور الجديدة المؤقتة (10 أحرف على الأقل):');
      if (pw === null) return;
      if (pw.length < 10) return toast('كلمة المرور قصيرة', false);
      var res = await sb.functions.invoke('admin-users', { body: { action: 'reset_password', user_id: id, password: pw } });
      if (res.error) return toast(await fnErrorMessage(res.error), false);
      if (res.data && res.data.error) return toast(res.data.error, false);
      return toast('تم تغيير كلمة المرور');
    }
  });

  app.addEventListener('change', async function (e) {
    var el = e.target;
    var action = el.dataset.action;

    if (action === 'set-role') {
      var id = el.closest('[data-id]').dataset.id;
      var up = await sb.from('profiles').update({ role_code: el.value }).eq('id', id).select('id');
      if (up.error) { toast(up.error.message, false); return render(); }
      if (!up.data || up.data.length === 0) { toast('لا تملك صلاحية تعديل هذا المستخدم', false); return render(); }
      toast('تم تغيير الدور');
      return render();
    }

    if (action === 'set-sellable') {
      var v = el.value === 'true' ? true : el.value === 'false' ? false : null;
      var code = el.dataset.code;
      var res = await sb.from('bird_classes').update({ is_sellable: v }).eq('code', code).select('code');
      if (res.error) { toast(res.error.message, false); return render(); }
      if (!res.data || res.data.length === 0) { toast('لا تملك صلاحية تغيير هذا الإعداد', false); return render(); }
      toast('تم حفظ صلاحية البيع');
      return render();
    }
  });

  app.addEventListener('submit', async function (e) {
    var f = e.target;
    if (f.id === 'loginForm') {
      e.preventDefault();
      var btn = f.querySelector('button');
      btn.disabled = true;
      var r = await sb.auth.signInWithPassword({
        email: f.email.value.trim(), password: f.password.value
      });
      btn.disabled = false;
      if (r.error) return renderLogin('البريد الإلكتروني أو كلمة المرور غير صحيحة');
      return render();
    }

    if (f.id === 'pwForm') {
      e.preventDefault();
      if (f.pw.value !== f.pw2.value) return toast('كلمتا المرور غير متطابقتين', false);
      var up = await sb.auth.updateUser({ password: f.pw.value });
      if (up.error) return toast(up.error.message, false);
      f.reset();
      return toast('تم تغيير كلمة المرور');
    }

    if (f.id === 'addUser') {
      e.preventDefault();
      var b = f.querySelector('button');
      b.disabled = true;
      var res = await sb.functions.invoke('admin-users', {
        body: {
          action: 'create',
          full_name: f.full_name.value,
          email: f.email.value,
          password: f.password.value,
          role_code: f.role_code.value
        }
      });
      b.disabled = false;
      if (res.error) return toast(await fnErrorMessage(res.error), false);
      if (res.data && res.data.error) return toast(res.data.error, false);
      toast('تم إنشاء المستخدم');
      return render();
    }
  });

  // ---------- دورة الجلسة ----------
  sb.auth.onAuthStateChange(function (event) {
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
      render();
    }
  });
  window.addEventListener('hashchange', function () { render(); });
})();
