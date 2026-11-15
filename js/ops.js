(function () {
  'use strict';

  // شاشات التشغيل: المزارع، شراء الحمولات، النقل، المسلخ والتصنيف والإنتاج.
  // كل عملية كتابة إما جدول محمي بـ RLS، أو دالة مفحوصة في قاعدة البيانات.
  // الواجهة لا تُعتبر حماية: التحقق الفعلي في قاعدة البيانات.

  var P = {};
  var st = { editFarm: null, editLoad: null, editTruck: null, batchId: null, runId: null };

  function C() { return window.PoultryCtx; }
  function esc(s) { return C().esc(s); }
  function uid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }
  function code(prefix) {
    return prefix + '-' + new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function isDup(e) { return !!(e && (e.code === '23505')); }
  function fail(e) { throw (e instanceof Error ? e : new Error(e && e.message ? e.message : 'خطأ غير معروف')); }
  function must(res) { if (res.error) fail(res.error); return res.data; }
  function sel(list, val, label, selected) {
    return list.map(function (x) {
      return '<option value="' + esc(x[val]) + '"' + (String(x[val]) === String(selected) ? ' selected' : '') + '>' + esc(label(x)) + '</option>';
    }).join('');
  }
  function sessionUser() { var s = C().session(); return s && s.user ? s.user.id : null; }
  function canWriteFarms() { return C().can('master.write') || C().can('purchases.write'); }

  // ---------- المزارع والموردين ----------
  P.farms = async function (el) {
    var q = must(await C().sb.from('farms').select('id,code,name,phone,region').order('name'));
    var w = canWriteFarms();
    var ed = st.editFarm ? q.find(function (f) { return f.id === st.editFarm; }) : null;
    var form = '';
    if (w) {
      form = '<section class="card"><h2>' + (ed ? 'تعديل مزرعة' : 'إضافة مزرعة أو مورد') + '</h2>' +
        '<form class="form" data-ops-form="farm">' +
        '<input type="hidden" name="id" value="' + (ed ? esc(ed.id) : '') + '">' +
        '<input name="name" placeholder="اسم المزرعة أو المورد" required value="' + (ed ? esc(ed.name) : '') + '">' +
        '<input name="phone" placeholder="الهاتف" dir="ltr" value="' + (ed ? esc(ed.phone || '') : '') + '">' +
        '<input name="region" placeholder="المنطقة" value="' + (ed ? esc(ed.region || '') : '') + '">' +
        '<button class="btn gold" type="submit">حفظ</button>' +
        (ed ? ' <button type="button" class="btn outline" data-ops="farm-cancel">إلغاء التعديل</button>' : '') +
        '</form></section>';
    }
    var rows = q.map(function (f) {
      return '<tr><td>' + esc(f.name) + '<br><small dir="ltr">' + esc(f.code) + '</small></td><td dir="ltr">' + esc(f.phone || '') + '</td><td>' + esc(f.region || '') + '</td>' +
        (w ? '<td><button class="btn small outline" data-ops="farm-edit" data-id="' + esc(f.id) + '">تعديل</button> ' +
             '<button class="btn small danger" data-ops="farm-del" data-id="' + esc(f.id) + '">حذف</button></td>' : '<td></td>') + '</tr>';
    }).join('');
    el.innerHTML = form +
      '<section class="card"><h2>المزارع والموردون (' + q.length + ')</h2><div class="table-wrap"><table>' +
      '<thead><tr><th>الاسم</th><th>الهاتف</th><th>المنطقة</th><th>إجراءات</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="4">لا توجد مزارع بعد</td></tr>') + '</tbody></table></div></section>';
  };

  async function farmSave(f) {
    var id = f.get('id');
    var data = { name: String(f.get('name') || '').trim(), phone: String(f.get('phone') || '').trim() || null, region: String(f.get('region') || '').trim() || null };
    if (!data.name) fail('اسم المزرعة مطلوب');
    if (id) {
      var up = await C().sb.from('farms').update(data).eq('id', id).select('id');
      if (up.error) fail(up.error);
      if (!up.data || !up.data.length) fail('لا تملك صلاحية تعديل هذه المزرعة');
    } else {
      data.id = uid(); data.code = code('F');
      var r = await C().sb.from('farms').insert(data);
      if (r.error && !isDup(r.error)) fail(r.error);
    }
    st.editFarm = null;
    C().toast('تم حفظ المزرعة');
  }

  async function farmDelete(id) {
    if (!confirm('حذف هذه المزرعة؟')) return;
    var r = await C().sb.from('farms').delete().eq('id', id).select('id');
    if (r.error) fail(r.error.message.indexOf('violates') >= 0 ? 'لا يمكن حذف مزرعة لها حمولات مسجلة' : r.error);
    if (!r.data || !r.data.length) fail('لا تملك صلاحية حذف هذه المزرعة');
    C().toast('تم حذف المزرعة');
  }

  // ---------- شراء الحمولات ----------
  P.loads = async function (el) {
    var farms = must(await C().sb.from('farms').select('id,name').order('name'));
    var loads = must(await C().sb.from('purchase_loads')
      .select('id,load_no,purchase_date,pricing_method,birds_count,gross_weight_kg,unit_price,amount_sar,status,notes,farm_id,farms(name)')
      .order('purchase_date', { ascending: false }));
    var bal = {};
    var b = await C().sb.from('v_supplier_balances').select('load_id,balance_sar');
    if (!b.error) b.data.forEach(function (x) { bal[x.load_id] = x.balance_sar; });
    var canW = C().can('purchases.write');
    var ed = st.editLoad ? loads.find(function (l) { return l.id === st.editLoad; }) : null;
    var form = '';
    if (canW) {
      if (!farms.length) form = '<section class="card"><p>أضف مزرعة أولاً من شاشة المزارع.</p></section>';
      else form = '<section class="card"><h2>' + (ed ? 'تعديل حمولة مفتوحة' : 'تسجيل شراء حمولة') + '</h2>' +
        '<form class="form" data-ops-form="load">' +
        '<input type="hidden" name="id" value="' + (ed ? esc(ed.id) : uid()) + '">' +
        '<select name="farm_id" required>' + sel(farms, 'id', function (f) { return f.name; }, ed ? ed.farm_id : '') + '</select>' +
        '<label>تاريخ الشراء<input type="date" name="purchase_date" required value="' + (ed ? esc(ed.purchase_date) : new Date().toISOString().slice(0, 10)) + '"></label>' +
        '<select name="pricing_method"><option value="piece"' + (!ed || ed.pricing_method === 'piece' ? ' selected' : '') + '>بسعر الحبة</option>' +
        '<option value="kg"' + (ed && ed.pricing_method === 'kg' ? ' selected' : '') + '>بسعر الكيلو</option></select>' +
        '<input type="number" name="birds_count" min="1" step="1" placeholder="عدد الدواجن" required value="' + (ed ? ed.birds_count : '') + '">' +
        '<input type="number" name="gross_weight_kg" min="0.001" step="0.001" placeholder="الوزن الإجمالي (كجم)" required value="' + (ed ? ed.gross_weight_kg : '') + '">' +
        '<input type="number" name="unit_price" min="0" step="0.0001" placeholder="سعر الكيلو أو الحبة (ريال)" required value="' + (ed ? ed.unit_price : '') + '">' +
        '<input name="notes" placeholder="ملاحظات" value="' + (ed ? esc(ed.notes || '') : '') + '">' +
        '<p class="muted">العملة: ريال سعودي. الإجمالي يحسبه النظام تلقائياً عند الحفظ.</p>' +
        '<button class="btn gold" type="submit">حفظ الحمولة</button>' +
        (ed ? ' <button type="button" class="btn outline" data-ops="load-cancel">إلغاء التعديل</button>' : '') +
        '</form></section>';
    }
    var rows = loads.map(function (l) {
      var isOpen = l.status === 'open';
      return '<tr><td>' + esc(l.load_no) + '<br><small>' + esc(l.purchase_date) + ' · ' + esc(l.farms ? l.farms.name : '') + '</small></td>' +
        '<td>' + esc(l.birds_count) + ' طير · ' + esc(l.gross_weight_kg) + ' كجم</td>' +
        '<td>' + esc(l.pricing_method === 'kg' ? 'كيلو' : 'حبة') + ' × ' + esc(l.unit_price) + '</td>' +
        '<td>' + esc(l.amount_sar) + ' ر.س</td>' +
        '<td>' + (bal[l.id] !== undefined ? esc(bal[l.id]) + ' ر.س' : '—') + '</td>' +
        '<td>' + (l.status === 'open' ? 'مفتوحة' : esc(l.status)) + '</td>' +
        '<td>' + (canW && isOpen ? '<button class="btn small outline" data-ops="load-edit" data-id="' + esc(l.id) + '">تعديل</button> ' +
             '<button class="btn small danger" data-ops="load-del" data-id="' + esc(l.id) + '">حذف</button>' : '') + '</td></tr>';
    }).join('');
    el.innerHTML = form +
      '<section class="card"><h2>الحمولات (' + loads.length + ')</h2><div class="table-wrap"><table>' +
      '<thead><tr><th>الحمولة</th><th>الطيور والوزن</th><th>التسعير</th><th>المبلغ</th><th>المتبقي للمورد</th><th>الحالة</th><th></th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="7">لا توجد حمولات بعد</td></tr>') + '</tbody></table></div></section>';
  };

  async function loadSave(f) {
    var id = String(f.get('id'));
    var data = {
      farm_id: f.get('farm_id'), purchase_date: f.get('purchase_date'),
      pricing_method: f.get('pricing_method'), birds_count: parseInt(f.get('birds_count'), 10),
      gross_weight_kg: num(f.get('gross_weight_kg')), unit_price: num(f.get('unit_price')),
      notes: String(f.get('notes') || '').trim() || null
    };
    if (!(data.birds_count > 0)) fail('عدد الدواجن يجب أن يكون أكبر من صفر');
    if (!(data.gross_weight_kg > 0)) fail('الوزن يجب أن يكون أكبر من صفر');
    if (st.editLoad) {
      var r = await C().sb.from('purchase_loads').update(data).eq('id', st.editLoad).select('id');
      if (r.error) fail(r.error);
      if (!r.data || !r.data.length) fail('لا تملك صلاحية تعديل هذه الحمولة');
    } else {
      data.id = id; data.load_no = code('L'); data.client_request_id = id;
      var ins = await C().sb.from('purchase_loads').insert(data);
      if (ins.error && !isDup(ins.error)) fail(ins.error);
    }
    st.editLoad = null;
    C().toast('تم حفظ الحمولة');
  }

  async function loadDelete(id) {
    if (!confirm('حذف هذه الحمولة المفتوحة؟')) return;
    var r = await C().sb.from('purchase_loads').delete().eq('id', id).select('id');
    if (r.error) fail(r.error.message.indexOf('violates') >= 0 ? 'لا يمكن حذف حمولة لها نقل أو تكاليف مسجلة' : r.error);
    if (!r.data || !r.data.length) fail('لا يمكن حذف هذه الحمولة (مغلقة أو مرتبطة بدفعة مسلخ)');
    C().toast('تم حذف الحمولة');
  }

  // ---------- النقل: التريلات والسائقون والطيور الواصلة ----------
  P.transport = async function (el) {
    var trucks = must(await C().sb.from('trucks').select('id,plate,model').order('plate'));
    var drivers = must(await C().sb.from('drivers').select('id,name,phone').order('name'));
    var loads = must(await C().sb.rpc('ops_loads'));
    var transports = must(await C().sb.from('load_transports')
      .select('id,load_id,truck_id,driver_id,departure_at,birds_loaded,birds_arrived,transit_mortality,notes')
      .order('departure_at', { ascending: false }));
    var lname = {}; loads.forEach(function (l) { lname[l.load_id] = l.load_no; });
    var tname = {}; trucks.forEach(function (t) { tname[t.id] = t.plate; });
    var dname = {}; drivers.forEach(function (d) { dname[d.id] = d.name; });
    var canW = C().can('purchases.write');
    var canFuel = canW;
    var openLoads = loads.filter(function (l) { return l.load_status === 'open'; });
    var ed = st.editTruck ? transports.find(function (t) { return t.id === st.editTruck; }) : null;

    var forms = '';
    if (canW) {
      forms = '<section class="card"><h2>' + (ed ? 'تعديل نقلة' : 'تسجيل نقلة (تريلة)') + '</h2>' +
        '<form class="form" data-ops-form="transport">' +
        '<input type="hidden" name="id" value="' + (ed ? esc(ed.id) : uid()) + '">' +
        '<select name="load_id" required ' + (ed ? 'disabled' : '') + '>' + sel(ed ? loads : openLoads, 'load_id', function (l) { return l.load_no; }, ed ? ed.load_id : '') + '</select>' +
        '<select name="truck_id" required>' + sel(trucks, 'id', function (t) { return t.plate; }, ed ? ed.truck_id : '') + '</select>' +
        '<select name="driver_id" required>' + sel(drivers, 'id', function (d) { return d.name; }, ed ? ed.driver_id : '') + '</select>' +
        '<label>وقت الانطلاق<input type="datetime-local" name="departure_at" value="' + (ed ? esc(ed.departure_at.slice(0, 16)) : new Date().toISOString().slice(0, 16)) + '"></label>' +
        '<input type="number" name="birds_loaded" min="1" step="1" required placeholder="عدد الطيور عند التحميل" value="' + (ed ? ed.birds_loaded : '') + '">' +
        '<input type="number" name="birds_arrived" min="0" step="1" required placeholder="عدد الطيور عند الوصول" value="' + (ed ? ed.birds_arrived : '') + '">' +
        (canFuel && !ed ? '<input type="number" name="fuel_sar" min="0" step="0.01" placeholder="تكلفة الوقود والنقل (ريال، اختياري)">' : '') +
        '<input name="notes" placeholder="ملاحظات" value="' + (ed ? esc(ed.notes || '') : '') + '">' +
        '<button class="btn gold" type="submit">حفظ النقلة</button>' +
        (ed ? ' <button type="button" class="btn outline" data-ops="tr-cancel">إلغاء التعديل</button>' : '') +
        '</form></section>' +
        '<section class="card"><h2>التريلات والسائقون</h2>' +
        '<form class="form" data-ops-form="truck"><input name="plate" placeholder="رقم التريلة" required dir="ltr"><input name="model" placeholder="الموديل (اختياري)">' +
        '<button class="btn outline" type="submit">إضافة تريلة</button></form>' +
        '<form class="form" data-ops-form="driver" style="margin-top:12px"><input name="name" placeholder="اسم السائق" required><input name="phone" placeholder="الهاتف" dir="ltr">' +
        '<button class="btn outline" type="submit">إضافة سائق</button></form>' +
        '<div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>التريلة</th><th>السائق</th><th></th></tr></thead><tbody>' +
        trucks.map(function (t) { return '<tr><td dir="ltr">' + esc(t.plate) + '</td><td colspan="1"></td><td><button class="btn small danger" data-ops="truck-del" data-id="' + esc(t.id) + '">حذف</button></td></tr>'; }).join('') +
        drivers.map(function (d) { return '<tr><td></td><td>' + esc(d.name) + '</td><td><button class="btn small danger" data-ops="driver-del" data-id="' + esc(d.id) + '">حذف</button></td></tr>'; }).join('') +
        '</tbody></table></div></section>';
    }
    var rows = transports.map(function (t) {
      var pct = t.birds_loaded ? ((t.birds_loaded - t.birds_arrived) * 100 / t.birds_loaded).toFixed(2) : '0';
      return '<tr><td>' + esc(lname[t.load_id] || '—') + '<br><small>' + esc(tname[t.truck_id] || '') + ' · ' + esc(dname[t.driver_id] || '') + '</small></td>' +
        '<td>' + esc(t.birds_loaded) + ' ← ' + esc(t.birds_arrived) + '</td>' +
        '<td>' + esc(t.transit_mortality) + ' طير (' + pct + '%)</td>' +
        '<td>' + (canW ? '<button class="btn small outline" data-ops="tr-edit" data-id="' + esc(t.id) + '">تعديل</button> ' +
             '<button class="btn small danger" data-ops="tr-del" data-id="' + esc(t.id) + '">حذف</button>' : '') + '</td></tr>';
    }).join('');
    el.innerHTML = forms +
      '<section class="card"><h2>النقلات (' + transports.length + ')</h2><div class="table-wrap"><table>' +
      '<thead><tr><th>الحمولة والتريلة</th><th>التحميل ← الوصول</th><th>النفوق في النقل</th><th></th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="4">لا توجد نقلات بعد</td></tr>') + '</tbody></table></div></section>';
  };

  async function transportSave(f) {
    var id = String(f.get('id'));
    if (st.editTruck) {
      var up = { truck_id: f.get('truck_id'), driver_id: f.get('driver_id'), birds_loaded: parseInt(f.get('birds_loaded'), 10),
                 birds_arrived: parseInt(f.get('birds_arrived'), 10), notes: String(f.get('notes') || '').trim() || null };
      if (up.birds_arrived > up.birds_loaded) fail('الطيور الواصلة أكبر من المحملة');
      var r = await C().sb.from('load_transports').update(up).eq('id', st.editTruck).select('id');
      if (r.error) fail(r.error);
      if (!r.data || !r.data.length) fail('لا تملك صلاحية تعديل هذه النقلة');
      st.editTruck = null; C().toast('تم تحديث النقلة'); return;
    }
    var loaded = parseInt(f.get('birds_loaded'), 10), arrived = parseInt(f.get('birds_arrived'), 10);
    if (!(loaded > 0)) fail('عدد الطيور عند التحميل يجب أن يكون أكبر من صفر');
    if (arrived < 0 || arrived > loaded) fail('عدد الطيور الواصلة يجب أن يكون بين صفر والمحملة');
    var row = {
      id: id, load_id: f.get('load_id'), truck_id: f.get('truck_id'), driver_id: f.get('driver_id'),
      departure_at: f.get('departure_at') ? new Date(f.get('departure_at')).toISOString() : new Date().toISOString(),
      birds_loaded: loaded, birds_arrived: arrived, notes: String(f.get('notes') || '').trim() || null
    };
    var ins = await C().sb.from('load_transports').insert(row);
    if (ins.error && !isDup(ins.error)) fail(ins.error);
    var fuel = num(f.get('fuel_sar'));
    if (fuel > 0) {
      var ex = await C().sb.from('expenses').insert({
        id: uid(), category_code: 'fuel_transport', load_id: row.load_id, amount_original: fuel,
        currency_code: 'SAR', fx_rate: 1, description: 'وقود ونقل - نقلة ' + id.slice(0, 8),
        client_request_id: id + '-fuel', created_by: sessionUser()
      });
      if (ex.error && !isDup(ex.error)) fail(ex.error);
    }
    C().toast('تم حفظ النقلة');
  }

  async function transportDelete(id) {
    if (!confirm('حذف هذه النقلة؟ تكلفة الوقود المسجلة لا تُحذف تلقائياً.')) return;
    var r = await C().sb.from('load_transports').delete().eq('id', id).select('id');
    if (r.error) fail(r.error);
    if (!r.data || !r.data.length) fail('لا تملك صلاحية حذف هذه النقلة');
    C().toast('تم حذف النقلة');
  }

  // ---------- المسلخ والتصنيف والإنتاج ----------
  P.slaughter = async function (el) {
    var batches = must(await C().sb.rpc('ops_batches'));
    var loads = must(await C().sb.rpc('ops_loads'));
    var houses = must(await C().sb.from('slaughterhouses').select('id,name').order('name'));
    var products = must(await C().sb.from('product_types').select('id,code,name_ar,is_whole_bird,allocation_factor').eq('is_active', true).order('code'));
    var classes = must(await C().sb.from('bird_classes').select('code,name_ar,is_sellable').order('code'));
    var hasBatch = {}; batches.forEach(function (b) { hasBatch[b.load_no] = true; });
    var freeLoads = loads.filter(function (l) { return l.load_status === 'open' && !hasBatch[l.load_no]; });
    st.classes = classes;
    var canP = C().can('production.write');
    var canCost = C().can('expenses.write');
    var canSeeCost = C().can('finance.read');
    var canMaster = C().can('master.write');

    var html = '';
    if (canP) {
      html += '<section class="card"><h2>استلام دفعة من المسلخ</h2>' +
        (freeLoads.length && houses.length ?
          '<form class="form" data-ops-form="batch-new">' +
          '<select name="load_id" required>' + sel(freeLoads, 'load_id', function (l) { return l.load_no + ' (' + l.birds_count + ' طير)'; }, '') + '</select>' +
          '<select name="slaughterhouse_id" required>' + sel(houses, 'id', function (h) { return h.name; }, '') + '</select>' +
          '<label>تاريخ الذبح<input type="date" name="slaughter_date" value="' + new Date().toISOString().slice(0, 10) + '"></label>' +
          '<input type="number" name="received" min="0" step="1" required placeholder="المستلم من النقل">' +
          '<input type="number" name="slaughtered" min="0" step="1" required placeholder="المذبوح الجيد">' +
          '<input type="number" name="dead" min="0" step="1" required placeholder="النافق في المسلخ">' +
          '<input type="number" name="rejected" min="0" step="1" required placeholder="المرفوض">' +
          '<button class="btn gold" type="submit">تسجيل الاستلام</button></form>'
          : '<p class="muted">' + (!houses.length ? 'أضف مسلخاً أولاً.' : 'لا توجد حمولات مفتوحة بلا دفعة. سجّل النقل أولاً.') + '</p>') +
        '</section>';
    }

    html += '<section class="card"><h2>الدفعات (' + batches.length + ')</h2><div class="table-wrap"><table>' +
      '<thead><tr><th>الحمولة</th><th>المسلخ</th><th>المستلم</th><th>المذبوح</th><th>النافق/المرفوض</th><th>الحالة</th><th></th></tr></thead><tbody>' +
      (batches.map(function (b) {
        return '<tr><td>' + esc(b.load_no) + '<br><small>' + esc(b.slaughter_date) + '</small></td><td>' + esc(b.slaughterhouse_name) + '</td>' +
          '<td>' + esc(b.received_birds) + '</td><td>' + esc(b.slaughtered_birds) + '</td>' +
          '<td>' + esc(b.dead_at_slaughter) + ' / ' + esc(b.rejected_birds) + '</td>' +
          '<td>' + (b.batch_status === 'closed' ? 'مغلقة' : 'مفتوحة') + '</td>' +
          '<td><button class="btn small outline" data-ops="batch-open" data-id="' + esc(b.batch_id) + '">فتح</button></td></tr>';
      }).join('') || '<tr><td colspan="7">لا توجد دفعات بعد</td></tr>') +
      '</tbody></table></div></section>';

    if (st.batchId) {
      var b = batches.find(function (x) { return x.batch_id === st.batchId; });
      if (!b) { st.batchId = null; } else {
        html += await batchDetail(b, classes, houses, products, canP, canCost, canSeeCost);
      }
    }

    if (canMaster) {
      html += '<section class="card"><h2>المنتجات (الكاملة والجانبية)</h2>' +
        '<form class="form" data-ops-form="product">' +
        '<input name="code" placeholder="رمز المنتج (مثال: LIVER)" required dir="ltr">' +
        '<input name="name_ar" placeholder="اسم المنتج" required>' +
        '<label><input type="checkbox" name="is_whole_bird" style="width:auto"> طير كامل (وليس منتجاً جانبياً)</label>' +
        '<input type="number" name="allocation_factor" min="0.0001" step="0.0001" value="1" placeholder="معامل توزيع التكلفة">' +
        '<button class="btn outline" type="submit">إضافة منتج</button></form>' +
        '<div class="table-wrap" style="margin-top:12px"><table><tbody>' +
        products.map(function (p) { return '<tr><td>' + esc(p.name_ar) + '<br><small dir="ltr">' + esc(p.code) + '</small></td><td>' + (p.is_whole_bird ? 'طير كامل' : 'منتج جانبي') + '</td><td>معامل ' + esc(p.allocation_factor) + '</td></tr>'; }).join('') +
        '</tbody></table></div></section>';
    }
    el.innerHTML = html;
  };

  async function batchDetail(b, classes, houses, products, canP, canCost, canSeeCost) {
    var closed = b.batch_status === 'closed';
    var grading = must(await C().sb.rpc('ops_grading')).filter(function (g) { return g.batch_id === b.batch_id; });
    var gTotal = grading.reduce(function (s, g) { return s + num(g.bird_count); }, 0);
    var gKg = grading.reduce(function (s, g) { return s + num(g.total_weight_kg); }, 0);
    var h = '<section class="card"><h2>دفعة ' + esc(b.load_no) + ' — ' + (closed ? 'مغلقة' : 'مفتوحة') + '</h2>' +
      '<p class="muted">المستلم ' + esc(b.received_birds) + ' · المذبوح الجيد ' + esc(b.slaughtered_birds) + ' · النافق ' + esc(b.dead_at_slaughter) + ' · المرفوض ' + esc(b.rejected_birds) +
      ' · المعالج ' + esc(b.birds_processed) + ' · المتبقي ' + esc(b.birds_remaining) + '</p>';

    if (!closed && canP) {
      h += '<form class="form" data-ops-form="batch-edit" data-id="' + esc(b.batch_id) + '">' +
        '<select name="slaughterhouse_id">' + sel(houses, 'id', function (x) { return x.name; }, '') + '</select>' +
        '<input type="number" name="received" min="0" step="1" value="' + esc(b.received_birds) + '">' +
        '<input type="number" name="slaughtered" min="0" step="1" value="' + esc(b.slaughtered_birds) + '">' +
        '<input type="number" name="dead" min="0" step="1" value="' + esc(b.dead_at_slaughter) + '">' +
        '<input type="number" name="rejected" min="0" step="1" value="' + esc(b.rejected_birds) + '">' +
        '<button class="btn outline" type="submit">تحديث الأرقام</button> ' +
        '<button class="btn danger" type="button" data-ops="batch-del" data-id="' + esc(b.batch_id) + '">حذف الدفعة</button></form>';
    }

    // التصنيف
    h += '<h2 style="margin-top:14px">التصنيف (A وB وغيرهما)</h2>';
    h += '<div class="table-wrap"><table><thead><tr><th>التصنيف</th><th>فئة الوزن (جم)</th><th>العدد</th><th>الوزن (كجم)</th></tr></thead><tbody>' +
      grading.map(function (g) { return '<tr><td>' + esc(g.class_name) + '</td><td>' + esc(g.weight_label) + '</td><td>' + esc(g.bird_count) + '</td><td>' + esc(g.total_weight_kg) + '</td></tr>'; }).join('') +
      '<tr><th>الإجمالي</th><th></th><th>' + gTotal + '</th><th>' + gKg.toFixed(3) + '</th></tr></tbody></table></div>';
    h += '<p class="muted">إغلاق الدفعة يتطلب أن يساوي مجموع التصنيف المذبوح الجيد (' + esc(b.slaughtered_birds) + ' طير).</p>';

    if (!closed && canP) {
      h += '<form class="form" data-ops-form="grading" data-id="' + esc(b.batch_id) + '" id="gradingForm">' +
        '<div id="gradeRows">' + (grading.length ? grading : [{}]).map(gradeRowHTML(classes)).join('') + '</div>' +
        '<button type="button" class="btn outline" data-ops="grade-add">إضافة صف</button> ' +
        '<button class="btn gold" type="submit">حفظ التصنيف</button> ' +
        '<button class="btn danger" type="button" data-ops="batch-close" data-id="' + esc(b.batch_id) + '">إغلاق الدفعة</button></form>';
    }

    // التكاليف (للمالية ومن يسجّلها فقط)
    if (canSeeCost) {
      var ex = must(await C().sb.from('expenses').select('id,category_code,amount_sar,description,expense_date').eq('batch_id', b.batch_id).order('expense_date'));
      h += '<h2 style="margin-top:14px">تكاليف الدفعة</h2>' +
        (ex.length ? '<div class="table-wrap"><table><tbody>' + ex.map(function (e) { return '<tr><td>' + esc(e.description || e.category_code) + '</td><td>' + esc(e.amount_sar) + ' ر.س</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted">لا توجد تكاليف مسجلة لهذه الدفعة.</p>');
      if (!closed && canCost) {
        h += '<form class="form" data-ops-form="batch-cost" data-id="' + esc(b.batch_id) + '">' +
          '<select name="category_code"><option value="slaughter_fee">أجرة الذبح</option><option value="cleaning">التنظيف والتجهيز</option><option value="packaging">التعبئة والأكياس</option><option value="loading">التحميل والتنزيل</option></select>' +
          '<input type="number" name="amount" min="0.01" step="0.01" required placeholder="المبلغ (ريال)">' +
          '<input name="description" placeholder="وصف (اختياري)">' +
          '<button class="btn outline" type="submit">إضافة تكلفة</button></form>';
      }
    }

    // الإنتاج: تشغيلات بعد إغلاق الدفعة
    if (closed) {
      var runs = must(await C().sb.rpc('ops_runs')).filter(function (r) { return r.batch_id === b.batch_id; });
      h += '<h2 style="margin-top:14px">تشغيلات الإنتاج</h2>';
      if (canP) {
        h += '<form class="form" data-ops-form="run-new" data-id="' + esc(b.batch_id) + '"><input type="hidden" name="request_id" value="' + uid() + '">' +
          '<select name="kind"><option value="whole">تشغيل طيور كاملة</option><option value="cut">تشغيل تقطيع (منتجات جانبية)</option></select>' +
          '<input type="number" name="birds" min="1" step="1" required placeholder="عدد الطيور المعالجة">' +
          '<label>التاريخ<input type="date" name="run_date" value="' + new Date().toISOString().slice(0, 10) + '"></label>' +
          '<button class="btn gold" type="submit">إنشاء تشغيل</button></form>';
      }
      h += '<div class="table-wrap"><table><tbody>' + runs.map(function (r) {
        return '<tr><td>' + esc(r.run_kind === 'whole' ? 'كامل' : 'تقطيع') + ' · ' + esc(r.birds_processed) + ' طير<br><small>' + esc(r.run_status === 'posted' ? 'مرحّل' : 'مسودة') + '</small></td>' +
          '<td><button class="btn small outline" data-ops="run-open" data-id="' + esc(r.run_id) + '">فتح</button></td></tr>';
      }).join('') + '</tbody></table></div>';
      if (st.runId) {
        var run = runs.find(function (r) { return r.run_id === st.runId; });
        if (run) h += await runDetail(run, products, canP);
      }
    }
    return h + '</section>';
  }

  function gradeRowHTML(classes) {
    return function (g) {
      return '<div class="grade-row" style="display:grid;gap:6px;grid-template-columns:1fr 1fr 1fr 1fr;margin-bottom:8px">' +
        '<select name="gr_class">' + sel(classes, 'code', function (c) { return c.name_ar; }, g.class_code || 'A') + '</select>' +
        '<input name="gr_label" placeholder="الوزن (جم)" value="' + esc(g.weight_label || '') + '">' +
        '<input name="gr_count" type="number" min="0" step="1" placeholder="العدد" value="' + esc(g.bird_count != null ? g.bird_count : '') + '">' +
        '<input name="gr_kg" type="number" min="0" step="0.001" placeholder="كجم" value="' + esc(g.total_weight_kg != null ? g.total_weight_kg : '') + '">' +
        '</div>';
    };
  }

  async function runDetail(run, products, canP) {
    var outs = must(await C().sb.rpc('ops_run_outputs')).filter(function (o) { return o.run_no === run.run_no; });
    var h = '<div class="card" style="margin-top:10px"><h2>' + esc(run.run_no) + ' — ' + (run.run_status === 'posted' ? 'مرحّل' : 'مسودة') + '</h2>' +
      '<div class="table-wrap"><table><tbody>' + outs.map(function (o) {
        return '<tr><td>' + esc(o.product_name) + '</td><td>' + esc(o.piece_count) + ' حبة</td><td>' + esc(o.weight_kg) + ' كجم</td></tr>';
      }).join('') + '</tbody></table></div>';
    if (run.run_status !== 'posted' && canP) {
      h += '<form class="form" data-ops-form="output" data-id="' + esc(run.run_id) + '">' +
        '<select name="product_id">' + sel(products, 'id', function (p) { return p.name_ar + (p.is_whole_bird ? ' (كامل)' : ''); }, '') + '</select>' +
        '<input type="number" name="pieces" min="1" step="1" required placeholder="العدد">' +
        '<input type="number" name="weight" min="0.001" step="0.001" required placeholder="الوزن (كجم)">' +
        '<button class="btn outline" type="submit">إضافة منتج للتشغيل</button></form>' +
        '<div class="flex-row"><button class="btn gold" data-ops="run-post" data-id="' + esc(run.run_id) + '">ترحيل التشغيل</button> ' +
        '<button class="btn danger" data-ops="run-del" data-id="' + esc(run.run_id) + '">حذف المسودة</button></div>';
    }
    return h + '</div>';
  }

  // ---------- معالجات الأحداث ----------
  async function handleSubmit(form) {
    var kind = form.getAttribute('data-ops-form');
    var f = new FormData(form);
    if (kind === 'farm') return farmSave(f);
    if (kind === 'load') return loadSave(f);
    if (kind === 'transport') return transportSave(f);
    if (kind === 'truck') {
      var r1 = await C().sb.from('trucks').insert({ id: uid(), plate: String(f.get('plate')).trim(), model: String(f.get('model') || '').trim() || null });
      if (r1.error && !isDup(r1.error)) fail(r1.error); return C().toast('تمت إضافة التريلة');
    }
    if (kind === 'driver') {
      var r2 = await C().sb.from('drivers').insert({ id: uid(), name: String(f.get('name')).trim(), phone: String(f.get('phone') || '').trim() || null });
      if (r2.error && !isDup(r2.error)) fail(r2.error); return C().toast('تمت إضافة السائق');
    }
    if (kind === 'batch-new') {
      must(await C().sb.rpc('create_slaughter_batch', {
        p_load_id: f.get('load_id'), p_slaughterhouse_id: f.get('slaughterhouse_id'), p_date: f.get('slaughter_date') || null,
        p_received: parseInt(f.get('received'), 10), p_slaughtered: parseInt(f.get('slaughtered'), 10),
        p_dead: parseInt(f.get('dead'), 10), p_rejected: parseInt(f.get('rejected'), 10)
      }));
      return C().toast('تم تسجيل استلام الدفعة');
    }
    if (kind === 'batch-edit') {
      must(await C().sb.rpc('update_slaughter_batch', {
        p_batch_id: form.getAttribute('data-id'), p_slaughterhouse_id: f.get('slaughterhouse_id'), p_date: null,
        p_received: parseInt(f.get('received'), 10), p_slaughtered: parseInt(f.get('slaughtered'), 10),
        p_dead: parseInt(f.get('dead'), 10), p_rejected: parseInt(f.get('rejected'), 10)
      }));
      return C().toast('تم تحديث الأرقام');
    }
    if (kind === 'grading') {
      var classes = f.getAll('gr_class'), labels = f.getAll('gr_label'), counts = f.getAll('gr_count'), kgs = f.getAll('gr_kg');
      var rows = [];
      for (var i = 0; i < classes.length; i++) {
        if (String(counts[i]).trim() === '' && String(kgs[i]).trim() === '') continue;
        rows.push({ class_code: classes[i], weight_label: labels[i] || '-', weight_g: parseInt(labels[i], 10) || null,
                    bird_count: parseInt(counts[i], 10) || 0, total_weight_kg: num(kgs[i]) });
      }
      must(await C().sb.rpc('save_grading', { p_batch_id: form.getAttribute('data-id'), p_rows: rows }));
      return C().toast('تم حفظ التصنيف');
    }
    if (kind === 'batch-cost') {
      var bid = form.getAttribute('data-id');
      var bl = must(await C().sb.rpc('ops_batches')).find(function (x) { return x.batch_id === bid; });
      var ld = must(await C().sb.rpc('ops_loads')).find(function (x) { return x.load_no === bl.load_no; });
      var ex = await C().sb.from('expenses').insert({ id: uid(), category_code: f.get('category_code'), load_id: ld.load_id, batch_id: bid,
        amount_original: num(f.get('amount')), currency_code: 'SAR', fx_rate: 1, description: String(f.get('description') || '').trim() || null,
        created_by: sessionUser() });
      if (ex.error && !isDup(ex.error)) fail(ex.error);
      return C().toast('تمت إضافة التكلفة');
    }
    if (kind === 'run-new') {
      must(await C().sb.rpc('create_production_run', {
        p_batch_id: form.getAttribute('data-id'), p_kind: f.get('kind'), p_birds: parseInt(f.get('birds'), 10),
        p_date: f.get('run_date') || null, p_request_id: f.get('request_id')
      }));
      return C().toast('تم إنشاء التشغيل');
    }
    if (kind === 'output') {
      must(await C().sb.rpc('add_production_output', {
        p_run_id: form.getAttribute('data-id'), p_product_id: f.get('product_id'),
        p_pieces: parseInt(f.get('pieces'), 10), p_weight: num(f.get('weight'))
      }));
      return C().toast('تمت إضافة المنتج للتشغيل');
    }
    if (kind === 'product') {
      var pr = await C().sb.from('product_types').insert({ id: uid(), code: String(f.get('code')).trim().toUpperCase(),
        name_ar: String(f.get('name_ar')).trim(), is_whole_bird: !!f.get('is_whole_bird'), allocation_factor: num(f.get('allocation_factor')) || 1 });
      if (pr.error && !isDup(pr.error)) fail(pr.error.message.indexOf('duplicate') >= 0 ? 'رمز المنتج مستخدم من قبل' : pr.error);
      return C().toast('تمت إضافة المنتج');
    }
    if (window.OpsExt) return window.OpsExt.submit(kind, form, f);
  }

  async function handleClick(btn) {
    var a = btn.getAttribute('data-ops'), id = btn.getAttribute('data-id');
    if (a === 'farm-edit') { st.editFarm = id; return C().refresh(); }
    if (a === 'farm-cancel') { st.editFarm = null; return C().refresh(); }
    if (a === 'farm-del') { await farmDelete(id); return C().refresh(); }
    if (a === 'load-edit') { st.editLoad = id; return C().refresh(); }
    if (a === 'load-cancel') { st.editLoad = null; return C().refresh(); }
    if (a === 'load-del') { await loadDelete(id); return C().refresh(); }
    if (a === 'tr-edit') { st.editTruck = id; return C().refresh(); }
    if (a === 'tr-cancel') { st.editTruck = null; return C().refresh(); }
    if (a === 'tr-del') { await transportDelete(id); return C().refresh(); }
    if (a === 'truck-del') { var t = await C().sb.from('trucks').delete().eq('id', id).select('id'); if (t.error) fail(t.error); return C().refresh(); }
    if (a === 'driver-del') { var d = await C().sb.from('drivers').delete().eq('id', id).select('id'); if (d.error) fail(d.error); return C().refresh(); }
    if (a === 'batch-open') { st.batchId = id; st.runId = null; return C().refresh(); }
    if (a === 'batch-del') {
      if (!confirm('حذف هذه الدفعة؟')) return;
      must(await C().sb.rpc('delete_slaughter_batch', { p_batch_id: id })); st.batchId = null; return C().refresh();
    }
    if (a === 'batch-close') {
      if (!confirm('إغلاق الدفعة؟ بعد الإغلاق لا يمكن تعديل التصنيف أو التكاليف.')) return;
      must(await C().sb.rpc('close_slaughter_batch', { p_batch_id: id })); return C().refresh();
    }
    if (a === 'grade-add') {
      var rowsEl = document.getElementById('gradeRows');
      if (rowsEl) {
        var tmp = document.createElement('div');
        tmp.innerHTML = gradeRowHTML(st.classes || [])({});
        rowsEl.appendChild(tmp.firstChild);
      }
      return;
    }
    if (a === 'run-open') { st.runId = id; return C().refresh(); }
    if (a === 'run-post') {
      if (!confirm('ترحيل التشغيل؟ لا يمكن تعديله بعد الترحيل.')) return;
      must(await C().sb.rpc('post_production_run', { p_run_id: id })); return C().refresh();
    }
    if (a === 'run-del') {
      if (!confirm('حذف مسودة التشغيل؟')) return;
      must(await C().sb.rpc('delete_production_run', { p_run_id: id })); st.runId = null; return C().refresh();
    }
    if (window.OpsExt) return window.OpsExt.click(a, btn);
  }

  // ---------- التسجيل والتوجيه ----------
  P.render = async function (id, el) {
    var fn = P[id];
    if (!fn) { el.innerHTML = '<div class="card err">شاشة غير معروفة</div>'; return; }
    await fn(el);
  };

  var app = document.getElementById('app');
  app.addEventListener('submit', async function (e) {
    var f = e.target;
    if (!f || !f.getAttribute || !f.getAttribute('data-ops-form')) return;
    e.preventDefault();
    var btn = f.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try { await handleSubmit(f); await C().refresh(); }
    catch (err) { C().toast(err.message || 'حدث خطأ', false); if (btn) btn.disabled = false; }
  });
  app.addEventListener('click', async function (e) {
    var b = e.target.closest && e.target.closest('[data-ops]');
    if (!b) return;
    e.preventDefault();
    b.disabled = true;
    try { await handleClick(b); }
    catch (err) { C().toast(err.message || 'حدث خطأ', false); }
    finally { b.disabled = false; }
  });

  window.OpsPages = P;
})();
