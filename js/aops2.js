(function () {
  'use strict';

  // الدفعة الثانية: المخزون، المبيعات، العملاء، التحصيل، المرتجعات.
  // الدفعة الثالثة: المصروفات، التقارير، الأرباح، الأرصدة، لوحة التحكم.
  // كل كتابة عبر جدول محمي بـ RLS أو دالة مفحوصة. الواجهة لا تُعتبر حماية.

  var st = { invoice: null, customer: null, editInv: null, purge: null };

  function C() { return window.PoultryCtx; }
  function esc(s) { return C().esc(s); }
  function uid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }
  function code(p) { return p + '-' + new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function money(v) { return num(v).toFixed(2); }
  function isDup(e) { return !!(e && e.code === '23505'); }
  function fail(e) { throw (e instanceof Error ? e : new Error(e && e.message ? e.message : 'خطأ غير معروف')); }
  function must(res) { if (res.error) fail(res.error); return res.data; }
  function today() { return new Date().toISOString().slice(0, 10); }
  function sel(list, val, label, selected) {
    return list.map(function (x) {
      return '<option value="' + esc(x[val]) + '"' + (String(x[val]) === String(selected) ? ' selected' : '') + '>' + esc(label(x)) + '</option>';
    }).join('');
  }
  function uidSession() { var s = C().session(); return s && s.user ? s.user.id : null; }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (window.Chart) return resolve();
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error('تعذّر تحميل مكتبة الرسوم')); };
      document.head.appendChild(s);
    });
  }

  var P = {};

  // ---------- المخزون ----------
  P.inventory = async function (el) {
    var stock = must(await C().sb.rpc('ops_product_stock'));
    var lots = C().can('stock.read') ? must(await C().sb.rpc('ops_stock_lots')) : [];
    var moves = C().can('stock.read') ? must(await C().sb.rpc('ops_stock_movements')).slice(0, 60) : [];
    var damaged = must(await C().sb.rpc('ops_damaged_returns'));
    var pending = C().can('stock.approve_adjust') ? must(await C().sb.from('stock_adjustments').select('id,lot_id,pieces_delta,weight_delta_kg,reason,status,created_at').eq('status', 'requested')) : [];
    var html = '<section class="card"><h2>الأرصدة (بلا تكلفة)</h2><div class="table-wrap"><table>' +
      '<thead><tr><th>المنتج</th><th>المتوفر (حبة)</th><th>المحجوز بفواتير مسودة</th><th>المتاح للبيع (حبة)</th><th>المتاح (كجم)</th></tr></thead><tbody>' +
      stock.map(function (s) {
        return '<tr><td>' + esc(s.product_name) + '<br><small dir="ltr">' + esc(s.product_code) + '</small></td>' +
          '<td>' + esc(num(s.pieces_on_hand).toFixed(0)) + '</td><td>' + esc(num(s.pieces_reserved).toFixed(0)) + ' حبة / ' + esc(num(s.weight_reserved_kg).toFixed(2)) + ' كجم</td>' +
          '<td><b>' + esc(num(s.pieces_available).toFixed(0)) + '</b></td><td>' + esc(num(s.weight_available_kg).toFixed(2)) + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="muted">المحجوز يُحسب من الفواتير المسودة وهو للإرشاد. الترحيل يتحقق من المتاح الفعلي في الدفعات.</p></section>';

    if (C().can('stock.request_adjust') && lots.length) {
      html += '<section class="card"><h2>طلب تسوية أو جرد</h2><form class="form" data-ops-form="adj-request">' +
        '<select name="lot_id" required>' + sel(lots, 'lot_id', function (l) { return l.product_name + ' · ' + l.load_no + ' · متبقٍ ' + num(l.pieces_remaining).toFixed(0) + ' حبة'; }, '') + '</select>' +
        '<input type="number" name="pieces" step="1" placeholder="فرق العدد (سالب للنقص)" value="0">' +
        '<input type="number" name="weight" step="0.001" placeholder="فرق الوزن كجم (اختياري)" value="0">' +
        '<input name="reason" placeholder="السبب (إلزامي)" required>' +
        '<button class="btn gold" type="submit">إرسال الطلب للاعتماد</button></form></section>';
    }
    if (pending.length) {
      html += '<section class="card"><h2>تسويات بانتظار الاعتماد (' + pending.length + ')</h2><div class="table-wrap"><table><tbody>' +
        pending.map(function (a) {
          return '<tr><td>' + esc(a.reason) + '<br><small>' + esc(a.created_at.slice(0, 10)) + '</small></td><td>' + esc(a.pieces_delta) + ' حبة · ' + esc(a.weight_delta_kg) + ' كجم</td>' +
            '<td><button class="btn small gold" data-ops="adj-approve" data-id="' + esc(a.id) + '">اعتماد</button></td></tr>';
        }).join('') + '</tbody></table></div></section>';
    }
    if (lots.length) {
      html += '<section class="card"><h2>الدفعات (' + lots.length + ')</h2><div class="table-wrap"><table><thead><tr><th>المنتج</th><th>الحمولة</th><th>الأولي</th><th>المتبقي</th></tr></thead><tbody>' +
        lots.map(function (l) {
          return '<tr><td>' + esc(l.product_name) + '</td><td>' + esc(l.load_no) + '</td><td>' + esc(l.pieces_initial) + ' حبة / ' + esc(num(l.weight_initial_kg).toFixed(2)) + ' كجم</td>' +
            '<td>' + esc(num(l.pieces_remaining).toFixed(0)) + ' حبة / ' + esc(num(l.weight_remaining_kg).toFixed(2)) + ' كجم</td></tr>';
        }).join('') + '</tbody></table></div></section>';
    }
    if (moves.length) {
      html += '<section class="card"><h2>آخر الحركات</h2><div class="table-wrap"><table><tbody>' +
        moves.map(function (m) {
          return '<tr><td>' + esc(m.created_at.slice(0, 16).replace('T', ' ')) + '</td><td>' + esc(m.movement_type) + '</td><td>' + esc(m.product_name) + '</td>' +
            '<td>' + esc(num(m.pieces_delta).toFixed(0)) + ' حبة</td><td>' + esc(m.note || m.load_no) + '</td></tr>';
        }).join('') + '</tbody></table></div></section>';
    }
    html += '<section class="card"><h2>المرتجعات التالفة (للمتابعة)</h2><div class="table-wrap"><table><tbody>' +
      (damaged.map(function (d) { return '<tr><td>' + esc(d.credit_note_no) + '</td><td>' + esc(d.product_name) + '</td><td>' + esc(d.quantity) + ' ' + esc(d.unit) + '</td></tr>'; }).join('') ||
        '<tr><td>لا توجد مرتجعات تالفة</td></tr>') + '</tbody></table></div></section>';
    el.innerHTML = html;
  };

  // ---------- العملاء والفواتير ----------
  P.sales = async function (el) {
    var customers = must(await C().sb.from('customers').select('id,code,name,customer_type,credit_limit,phone').eq('is_active', true).order('name'));
    var products = must(await C().sb.from('product_types').select('id,code,name_ar,pieces_per_carton').eq('is_active', true).order('name_ar'));
    var invoices = must(await C().sb.from('sales_invoices').select('id,invoice_no,customer_id,invoice_date,sale_type,status,total,prices_include_vat').order('invoice_date', { ascending: false }).limit(100));
    var cname = {}; customers.forEach(function (c) { cname[c.id] = c.name; });
    st.products = products;
    var canM = C().can('master.write');
    var html = '';
    if (canM) html += '<section class="card"><h2>إضافة عميل (مندوب مستقل أو تاجر جملة)</h2><form class="form" data-ops-form="customer">' +
      '<input name="name" placeholder="الاسم" required><input name="phone" placeholder="الهاتف" dir="ltr"><input name="car_plate" placeholder="رقم السيارة (اختياري)">' +
      '<select name="customer_type"><option value="agent">مندوب مستقل</option><option value="wholesale">تاجر جملة</option></select>' +
      '<input type="number" name="credit_limit" min="0" step="0.01" placeholder="حد ائتماني (اختياري)">' +
      '<button class="btn outline" type="submit">حفظ العميل</button></form></section>';

    var rows = [];
    for (var i = 0; i < customers.length; i++) {
      var bal = await C().sb.rpc('customer_balance', { p_customer_id: customers[i].id });
      rows.push('<tr><td>' + esc(customers[i].name) + '<br><small>' + esc(customers[i].customer_type === 'agent' ? 'مندوب مستقل' : 'تاجر جملة') + '</small></td>' +
        '<td>' + (bal.error || bal.data === null ? '—' : esc(money(bal.data)) + ' ر.س') + '</td>' +
        '<td>' + (customers[i].credit_limit != null ? esc(money(customers[i].credit_limit)) : 'بلا حد') + '</td></tr>');
    }
    html += '<section class="card"><h2>العملاء وأرصدتهم</h2><div class="table-wrap"><table><thead><tr><th>العميل</th><th>الرصيد المستحق</th><th>الحد الائتماني</th></tr></thead><tbody>' +
      (rows.join('') || '<tr><td colspan="3">لا يوجد عملاء</td></tr>') + '</tbody></table></div></section>';

    if (customers.length && products.length) {
      var editing = st.editInv ? invoices.find(function (x) { return x.id === st.editInv; }) : null;
      var editLines = [];
      if (editing) {
        editLines = must(await C().sb.from('sales_invoice_lines').select('product_id,unit,quantity,unit_price').eq('invoice_id', editing.id));
      }
      var holderHTML = editing
        ? editLines.map(function (l) {
            return '<div class="inv-line" style="display:grid;gap:6px;grid-template-columns:1.4fr 1fr 1fr 1fr;margin-bottom:8px">' +
              '<select name="product_id">' + sel(products, 'id', function (p) { return p.name_ar; }, l.product_id) + '</select>' +
              '<select name="unit">' + ['piece','kg','carton'].map(function (u) { return '<option value="' + u + '"' + (u === l.unit ? ' selected' : '') + '>' + ({piece:'حبة',kg:'كيلو',carton:'كرتون'})[u] + '</option>'; }).join('') + '</select>' +
              '<input name="quantity" type="number" min="0.001" step="0.001" value="' + esc(l.quantity) + '">' +
              '<input name="unit_price" type="number" min="0" step="0.01" value="' + esc(l.unit_price) + '">' +
              '</div>';
          }).join('')
        : invLineHTML(products);
      html += '<section class="card"><h2>' + (editing ? 'تعديل مسودة فاتورة' : 'فاتورة بيع جديدة (متعددة الأصناف)') + '</h2>' +
        '<form class="form" data-ops-form="' + (editing ? 'invoice-update' : 'invoice') + '"' + (editing ? ' data-id="' + esc(editing.id) + '"' : '') + '>' +
        '<input type="hidden" name="request_id" value="' + uid() + '">' +
        '<select name="customer_id" required>' + sel(customers, 'id', function (c) { return c.name; }, editing ? editing.customer_id : '') + '</select>' +
        '<select name="sale_type"><option value="cash"' + (!editing || editing.sale_type === 'cash' ? ' selected' : '') + '>نقدي</option><option value="credit"' + (editing && editing.sale_type === 'credit' ? ' selected' : '') + '>آجل</option></select>' +
        '<label><input type="checkbox" name="incl" style="width:auto"' + (editing && editing.prices_include_vat ? ' checked' : '') + '> الأسعار شاملة الضريبة</label>' +
        '<div id="invLines">' + holderHTML + '</div>' +
        '<button type="button" class="btn outline" data-ops="line-add">إضافة صنف</button> ' +
        '<button class="btn gold" type="submit">' + (editing ? 'حفظ التعديل' : 'حفظ المسودة') + '</button>' +
        (editing ? ' <button type="button" class="btn outline" data-ops="inv-cancel-edit">إلغاء التعديل</button>' : '') +
        '</form>' +
        '<p class="muted">الحفظ ذرّي: إما تُحفظ الفاتورة كاملة مع حجز أصنافها، أو لا يُحفظ شيء. المسودة تحجز الكميات حتى تُرحَّل أو تُحذف.</p></section>';
    }

    html += '<section class="card"><h2>الفواتير (آخر 100)</h2><div class="table-wrap"><table><thead><tr><th>الفاتورة</th><th>العميل</th><th>النوع</th><th>الإجمالي</th><th>الحالة</th><th></th></tr></thead><tbody>' +
      invoices.map(function (i) {
        return '<tr><td>' + esc(i.invoice_no || 'مسودة') + '<br><small>' + esc(i.invoice_date) + '</small></td><td>' + esc(cname[i.customer_id] || '') + '</td>' +
          '<td>' + (i.sale_type === 'cash' ? 'نقدي' : 'آجل') + '</td><td>' + esc(money(i.total)) + '</td><td>' + (i.status === 'posted' ? 'مرحّلة' : (i.status === 'draft' ? 'مسودة' : esc(i.status))) + '</td>' +
          '<td>' + (i.status === 'draft' ? '<button class="btn small outline" data-ops="inv-edit" data-id="' + esc(i.id) + '">تعديل</button> <button class="btn small gold" data-ops="inv-post" data-id="' + esc(i.id) + '">ترحيل</button> <button class="btn small danger" data-ops="inv-del" data-id="' + esc(i.id) + '">إلغاء المسودة</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';
    el.innerHTML = html;
  };

  function invLineHTML(products) {
    return '<div class="inv-line" style="display:grid;gap:6px;grid-template-columns:1.4fr 1fr 1fr 1fr;margin-bottom:8px">' +
      '<select name="product_id">' + sel(products, 'id', function (p) { return p.name_ar; }, '') + '</select>' +
      '<select name="unit"><option value="piece">حبة</option><option value="kg">كيلو</option><option value="carton">كرتون</option></select>' +
      '<input name="quantity" type="number" min="0.001" step="0.001" placeholder="الكمية">' +
      '<input name="unit_price" type="number" min="0" step="0.01" placeholder="سعر الوحدة">' +
      '</div>';
  }

  // ---------- التحصيل ----------
  P.payments = async function (el) {
    var customers = must(await C().sb.from('customers').select('id,name').eq('is_active', true).order('name'));
    var invoices = must(await C().sb.from('sales_invoices').select('id,invoice_no,customer_id,total').eq('status', 'posted').order('invoice_date', { ascending: false }).limit(200));
    var pays = must(await C().sb.from('customer_payments').select('id,customer_id,invoice_id,amount_sar,payment_date,method').order('payment_date', { ascending: false }).limit(100));
    var cname = {}; customers.forEach(function (c) { cname[c.id] = c.name; });
    var html = '<section class="card"><h2>تسجيل تحصيل من عميل</h2>' +
      (customers.length ? '<form class="form" data-ops-form="payment" id="payForm"><input type="hidden" name="request_id" value="' + uid() + '">' +
        '<select name="customer_id" required>' + sel(customers, 'id', function (c) { return c.name; }, '') + '</select>' +
        '<select name="invoice_id"><option value="">بلا فاتورة محددة (دفعة على الحساب)</option>' + invoices.map(function (i) { return '<option value="' + esc(i.id) + '">' + esc(i.invoice_no) + ' · ' + esc(money(i.total)) + ' ر.س</option>'; }).join('') + '</select>' +
        '<input type="number" name="amount" min="0.01" step="0.01" required placeholder="المبلغ (ريال)">' +
        '<select name="method"><option value="cash">نقدي</option><option value="bank_transfer">تحويل بنكي</option><option value="other">أخرى</option></select>' +
        '<label>التاريخ<input type="date" name="payment_date" value="' + today() + '"></label>' +
        '<button class="btn gold" type="submit">تسجيل التحصيل</button></form>' : '<p class="muted">لا يوجد عملاء.</p>') + '</section>';
    html += '<section class="card"><h2>آخر التحصيلات</h2><div class="table-wrap"><table><tbody>' +
      pays.map(function (p) { return '<tr><td>' + esc(cname[p.customer_id] || '') + '<br><small>' + esc(p.payment_date) + '</small></td><td>' + esc(money(p.amount_sar)) + ' ر.س</td><td>' + esc(p.method) + '</td></tr>'; }).join('') +
      '</tbody></table></div></section>';
    el.innerHTML = html;
  };

  // ---------- المرتجعات ----------
  P.returns = async function (el) {
    var invoices = must(await C().sb.from('sales_invoices').select('id,invoice_no,customer_id').eq('status', 'posted').order('invoice_date', { ascending: false }).limit(200));
    var cns = must(await C().sb.from('credit_notes').select('id,credit_note_no,note_date,total,status,reason').order('note_date', { ascending: false }).limit(100));
    var html = '<section class="card"><h2>مرتجع جديد (إشعار دائن)</h2>';
    if (invoices.length) {
      html += '<form class="form" data-ops-form="cn-select"><select name="invoice_id" required>' + sel(invoices, 'id', function (i) { return i.invoice_no; }, st.invoice || '') + '</select>' +
        '<button class="btn outline" type="submit">عرض أصناف الفاتورة</button></form>';
      if (st.invoice) {
        var lines = must(await C().sb.rpc('sales_lines_for_return', { p_invoice_id: st.invoice }));
        html += '<form class="form" data-ops-form="cn-create" data-id="' + esc(st.invoice) + '" style="margin-top:10px">' +
          '<input type="hidden" name="request_id" value="' + uid() + '"><input name="reason" placeholder="سبب المرتجع" required>' +
          '<div class="table-wrap"><table><thead><tr><th>الصنف</th><th>المتبقي</th><th>الكمية المرتجعة</th><th>الحالة</th></tr></thead><tbody>' +
          lines.map(function (l) {
            return '<tr><td>' + esc(l.product_name) + ' (' + esc(l.unit) + ')</td><td>' + esc(num(l.remaining_qty).toFixed(3)) + '</td>' +
              '<td><input type="hidden" name="line_id" value="' + esc(l.line_id) + '"><input name="qty" type="number" min="0" step="0.001" max="' + esc(l.remaining_qty) + '" value="0"></td>' +
              '<td><select name="cond"><option value="good">صالح (يعود للمخزون)</option><option value="damaged">تالف</option></select></td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<button class="btn gold" type="submit">حفظ وترحيل الإشعار</button></form>';
      }
    } else html += '<p class="muted">لا توجد فواتير مرحّلة.</p>';
    html += '</section><section class="card"><h2>إشعارات الدائن</h2><div class="table-wrap"><table><tbody>' +
      cns.map(function (c) { return '<tr><td>' + esc(c.credit_note_no || 'مسودة') + '<br><small>' + esc(c.note_date) + '</small></td><td>' + esc(money(c.total)) + ' ر.س</td><td>' + (c.status === 'posted' ? 'مرحّل' : 'مسودة') + '</td></tr>'; }).join('') +
      '</tbody></table></div></section>';
    el.innerHTML = html;
  };

  // ---------- المصروفات (المرحلة الثالثة) ----------
  P.expenses = async function (el) {
    var cats = must(await C().sb.from('expense_categories').select('code,name_ar,is_load_cost').eq('is_active', true).order('name_ar'));
    var loads = must(await C().sb.rpc('ops_loads'));
    var list = must(await C().sb.from('expenses').select('id,expense_date,category_code,amount_sar,description,load_id,reverses_id,correction_reason').order('expense_date', { ascending: false }).limit(200));
    var reversed = {};
    list.forEach(function (x) { if (x.reverses_id) reversed[x.reverses_id] = true; });
    var lname = {}; loads.forEach(function (l) { lname[l.load_id] = l.load_no; });
    var cname = {}; cats.forEach(function (c) { cname[c.code] = c.name_ar; });
    var html = '';
    if (C().can('expenses.write')) {
      html += '<section class="card"><h2>تسجيل مصروف</h2><form class="form" data-ops-form="expense"><input type="hidden" name="id" value="' + uid() + '">' +
        '<select name="category_code">' + sel(cats, 'code', function (c) { return c.name_ar; }, '') + '</select>' +
        '<select name="load_id"><option value="">غير مرتبط بحمولة (مصروف عام)</option>' + loads.map(function (l) { return '<option value="' + esc(l.load_id) + '">' + esc(l.load_no) + '</option>'; }).join('') + '</select>' +
        '<input type="number" name="amount" min="0.01" step="0.01" required placeholder="المبلغ (ريال)">' +
        '<label>التاريخ<input type="date" name="expense_date" value="' + today() + '"></label>' +
        '<input name="description" placeholder="الوصف">' +
        '<button class="btn gold" type="submit">حفظ المصروف</button></form></section>';
    }
    html += '<section class="card"><h2>المصروفات</h2><div class="table-wrap"><table><tbody>' +
      list.map(function (e) {
        var canRev = C().can('expenses.write') && !e.reverses_id && !reversed[e.id];
        var tag = e.reverses_id ? ' <small>(قيد عكسي: ' + esc(e.correction_reason || '') + ')</small>' : (reversed[e.id] ? ' <small>(معكوس)</small>' : '');
        return '<tr><td>' + esc(e.expense_date) + '</td><td>' + esc(cname[e.category_code] || e.category_code) + (e.load_id ? ' · ' + esc(lname[e.load_id] || '') : '') + '</td><td>' + esc(e.description || '') + tag + '</td><td>' + esc(money(e.amount_sar)) + ' ر.س</td>' +
          '<td>' + (canRev ? '<button class="btn small outline" data-ops="exp-reverse" data-id="' + esc(e.id) + '">قيد عكسي</button>' : '') + '</td></tr>';
      }).join('') +
      '</tbody></table></div></section>';
    el.innerHTML = html;
  };

  // ---------- التقارير المالية والتشغيلية ----------
  P.reports = async function (el) {
    var prof = must(await C().sb.from('v_sales_profit').select('invoice_id,invoice_no,invoice_date,net_sales_excl_vat,credit_excl_vat,net_cogs_sar'));
    var exp = must(await C().sb.from('expenses').select('amount_sar,load_id,category_code,expense_date'));
    var cust = must(await C().sb.from('v_customer_balances').select('name,balance_sar').order('name'));
    var supp = must(await C().sb.from('v_supplier_balances').select('load_no,farm_name,balance_sar'));
    var pays = must(await C().sb.from('customer_payments').select('amount_sar'));
    var spays = must(await C().sb.from('supplier_payments').select('amount_sar'));
    var batches = must(await C().sb.rpc('ops_batches'));

    var sales = prof.reduce(function (s, x) { return s + num(x.net_sales_excl_vat) - num(x.credit_excl_vat); }, 0);
    var cogs = prof.reduce(function (s, x) { return s + num(x.net_cogs_sar); }, 0);
    var gross = sales - cogs;
    var opex = exp.filter(function (e) { return !e.load_id; }).reduce(function (s, e) { return s + num(e.amount_sar); }, 0);
    var net = gross - opex;
    var cashIn = pays.reduce(function (s, p) { return s + num(p.amount_sar); }, 0);
    var cashOut = spays.reduce(function (s, p) { return s + num(p.amount_sar); }, 0) + exp.reduce(function (s, e) { return s + num(e.amount_sar); }, 0);

    el.innerHTML =
      '<section class="card"><h2>الأرباح والخسائر</h2><div class="table-wrap"><table><tbody>' +
      '<tr><td>صافي المبيعات (بدون ضريبة، بعد المرتجعات)</td><td>' + money(sales) + ' ر.س</td></tr>' +
      '<tr><td>تكلفة البضاعة المباعة</td><td>' + money(cogs) + ' ر.س</td></tr>' +
      '<tr><th>مجمل الربح</th><th>' + money(gross) + ' ر.س</th></tr>' +
      '<tr><td>مصروفات تشغيلية عامة (غير مرتبطة بحمولة)</td><td>' + money(opex) + ' ر.س</td></tr>' +
      '<tr><th>صافي الربح</th><th>' + money(net) + ' ر.س</th></tr></tbody></table></div>' +
      '<p class="muted">تكاليف الحمولات محسوبة داخل تكلفة البضاعة المباعة، فلا تُضاف مرتين.</p></section>' +
      '<section class="card"><h2>حركة النقدية</h2><div class="table-wrap"><table><tbody>' +
      '<tr><td>تحصيلات من العملاء</td><td>' + money(cashIn) + ' ر.س</td></tr>' +
      '<tr><td>مدفوعات للموردين ومصروفات</td><td>' + money(cashOut) + ' ر.س</td></tr>' +
      '<tr><th>صافي النقدية</th><th>' + money(cashIn - cashOut) + ' ر.س</th></tr></tbody></table></div></section>' +
      '<section class="card"><h2>مديونية العملاء</h2><div class="table-wrap"><table><tbody>' +
      cust.map(function (c) { return '<tr><td>' + esc(c.name) + '</td><td>' + money(c.balance_sar) + ' ر.س</td></tr>'; }).join('') + '</tbody></table></div></section>' +
      '<section class="card"><h2>مستحقات الموردين (حسب الحمولة)</h2><div class="table-wrap"><table><tbody>' +
      supp.map(function (s) { return '<tr><td>' + esc(s.load_no) + ' · ' + esc(s.farm_name) + '</td><td>' + money(s.balance_sar) + ' ر.س</td></tr>'; }).join('') + '</tbody></table></div></section>' +
      '<section class="card"><h2>تقرير التشغيل</h2><div class="table-wrap"><table><tbody>' +
      batches.map(function (b) { return '<tr><td>' + esc(b.load_no) + '</td><td>مستلم ' + esc(b.received_birds) + ' · مذبوح ' + esc(b.slaughtered_birds) + ' · نافق ' + esc(b.dead_at_slaughter) + ' · مرفوض ' + esc(b.rejected_birds) + '</td><td>معالج ' + esc(b.birds_processed) + ' · متبقٍ ' + esc(b.birds_remaining) + '</td></tr>'; }).join('') +
      '</tbody></table></div></section>';
  };

  // ---------- لوحة التحكم والرسوم البيانية ----------
  P.dashboard = async function (el) {
    var prof = must(await C().sb.from('v_sales_profit').select('invoice_date,net_sales_excl_vat,credit_excl_vat,net_cogs_sar'));
    var exp = must(await C().sb.from('expenses').select('amount_sar,category_code,load_id'));
    var stock = must(await C().sb.rpc('ops_product_stock'));
    var cust = must(await C().sb.from('v_customer_balances').select('balance_sar'));
    var supp = must(await C().sb.from('v_supplier_balances').select('balance_sar'));
    var sales = prof.reduce(function (s, x) { return s + num(x.net_sales_excl_vat) - num(x.credit_excl_vat); }, 0);
    var cogs = prof.reduce(function (s, x) { return s + num(x.net_cogs_sar); }, 0);
    var opex = exp.filter(function (e) { return !e.load_id; }).reduce(function (s, e) { return s + num(e.amount_sar); }, 0);
    var recv = cust.reduce(function (s, c) { return s + num(c.balance_sar); }, 0);
    var pay = supp.reduce(function (s, c) { return s + num(c.balance_sar); }, 0);
    var byDay = {}; prof.forEach(function (x) { byDay[x.invoice_date] = (byDay[x.invoice_date] || 0) + num(x.net_sales_excl_vat) - num(x.credit_excl_vat); });
    var byCat = {}; exp.forEach(function (e) { byCat[e.category_code] = (byCat[e.category_code] || 0) + num(e.amount_sar); });

    var purgeHTML = '';
    if (C().can('users.manage')) {
      purgeHTML = '<section class="card"><h2>تنظيف بيانات الاختبار (TEST)</h2>' +
        '<p class="muted">يحذف فقط السجلات الموسومة TEST. لا يمس أي بيانات حقيقية.</p>' +
        (st.purge
          ? '<div class="table-wrap"><table><tbody>' + Object.keys(st.purge).map(function (k) {
              return '<tr><td>' + esc(k) + '</td><td>' + esc(st.purge[k]) + '</td></tr>';
            }).join('') + '</tbody></table></div>' +
            '<p>سيُحذف ما مجموعه <b>' + Object.keys(st.purge).reduce(function (s, k) { return s + Number(st.purge[k] || 0); }, 0) + '</b> سجلاً.</p>' +
            '<input id="purgeConfirm" placeholder="اكتب TEST للتأكيد" dir="ltr">' +
            '<div class="flex-row"><button class="btn danger" data-ops="purge-run">تنفيذ الحذف</button></div>'
          : '<button class="btn outline" data-ops="purge-open">معاينة عدد السجلات</button>') +
        '</section>';
    }

    el.innerHTML = purgeHTML +
      '<section class="card"><div class="kpis" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      kpi('صافي المبيعات', money(sales) + ' ر.س') + kpi('مجمل الربح', money(sales - cogs) + ' ر.س') +
      kpi('صافي الربح', money(sales - cogs - opex) + ' ر.س') + kpi('مديونية العملاء', money(recv) + ' ر.س') +
      kpi('مستحقات الموردين', money(pay) + ' ر.س') + kpi('المتاح للبيع (حبة)', stock.reduce(function (s, x) { return s + num(x.pieces_available); }, 0).toFixed(0)) +
      '</div></section>' +
      '<section class="card"><h2>المبيعات حسب اليوم</h2><canvas id="chartSales" height="200"></canvas></section>' +
      '<section class="card"><h2>المصروفات حسب الفئة</h2><canvas id="chartExp" height="200"></canvas></section>' +
      '<section class="card"><h2>المتاح للبيع حسب المنتج</h2><canvas id="chartStock" height="200"></canvas></section>';

    try {
      await loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js');
      var days = Object.keys(byDay).sort();
      new window.Chart(document.getElementById('chartSales'), { type: 'bar', data: { labels: days, datasets: [{ label: 'ر.س', data: days.map(function (d) { return byDay[d]; }), backgroundColor: '#0b1f3a' }] }, options: { responsive: true, plugins: { legend: { display: false } } } });
      var cats = Object.keys(byCat);
      new window.Chart(document.getElementById('chartExp'), { type: 'doughnut', data: { labels: cats, datasets: [{ data: cats.map(function (c) { return byCat[c]; }), backgroundColor: ['#0b1f3a', '#c9a227', '#13305a', '#f6eccc', '#6b7280', '#b42318', '#1e7b4a', '#9ca3af', '#d97706'] }] } });
      new window.Chart(document.getElementById('chartStock'), { type: 'bar', data: { labels: stock.map(function (s) { return s.product_name; }), datasets: [{ label: 'حبة', data: stock.map(function (s) { return num(s.pieces_available); }), backgroundColor: '#c9a227' }] }, options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } } } });
    } catch (e) {
      var note = document.createElement('p'); note.className = 'muted'; note.textContent = 'تعذّر تحميل الرسوم البيانية (يتطلب اتصالاً بالإنترنت). الأرقام أعلاه تعمل بدونها.';
      el.appendChild(note);
    }
  };

  function kpi(label, value) {
    return '<div style="background:var(--gold-soft);border-radius:10px;padding:10px"><small>' + label + '</small><div style="font-size:18px;font-weight:700;color:var(--navy)">' + value + '</div></div>';
  }

  // ---------- معالجات الكتابة ----------
  async function submit(kind, form, f) {
    if (kind === 'adj-request') {
      var r = await C().sb.from('stock_adjustments').insert({ id: uid(), lot_id: f.get('lot_id'), pieces_delta: parseInt(f.get('pieces'), 10) || 0,
        weight_delta_kg: num(f.get('weight')), reason: String(f.get('reason')).trim(), status: 'requested', requested_by: uidSession() });
      if (r.error && !isDup(r.error)) fail(r.error);
      return C().toast('أُرسل طلب التسوية للاعتماد');
    }
    if (kind === 'customer') {
      var c = await C().sb.from('customers').insert({ id: uid(), code: code('C'), name: String(f.get('name')).trim(), phone: String(f.get('phone') || '').trim() || null,
        car_plate: String(f.get('car_plate') || '').trim() || null, customer_type: f.get('customer_type'),
        credit_limit: f.get('credit_limit') ? num(f.get('credit_limit')) : null });
      if (c.error && !isDup(c.error)) fail(c.error);
      return C().toast('تم حفظ العميل');
    }
    if (kind === 'invoice') {
      must(await C().sb.rpc('create_sales_invoice', {
        p_request_id: f.get('request_id'), p_customer_id: f.get('customer_id'), p_sale_type: f.get('sale_type'),
        p_incl: !!f.get('incl'), p_lines: linesFromForm(f)
      }));
      return C().toast('تم حفظ مسودة الفاتورة');
    }
    if (kind === 'invoice-update') {
      must(await C().sb.rpc('update_sales_draft', {
        p_invoice_id: form.getAttribute('data-id'), p_customer_id: f.get('customer_id'), p_sale_type: f.get('sale_type'),
        p_incl: !!f.get('incl'), p_lines: linesFromForm(f)
      }));
      st.editInv = null;
      return C().toast('تم تعديل المسودة وتحديث الحجز');
    }
    if (kind === 'payment') {
      must(await C().sb.rpc('record_customer_payment', {
        p_customer_id: f.get('customer_id'), p_invoice_id: f.get('invoice_id') || null, p_amount: num(f.get('amount')),
        p_method: f.get('method'), p_request_id: f.get('request_id'), p_date: f.get('payment_date') || null }));
      return C().toast('تم تسجيل التحصيل');
    }
    if (kind === 'cn-select') { st.invoice = f.get('invoice_id'); return; }
    if (kind === 'cn-create') {
      var cid = uid();
      var ch = await C().sb.from('credit_notes').insert({ id: cid, invoice_id: form.getAttribute('data-id'),
        customer_id: await invoiceCustomer(form.getAttribute('data-id')), note_date: today(), reason: String(f.get('reason')).trim(),
        created_by: uidSession(), client_request_id: f.get('request_id') });
      if (ch.error && !isDup(ch.error)) fail(ch.error);
      var ids = f.getAll('line_id'), qty = f.getAll('qty'), cond = f.getAll('cond');
      var cl = [];
      for (var j = 0; j < ids.length; j++) {
        if (!(num(qty[j]) > 0)) continue;
        cl.push({ id: uid(), credit_note_id: cid, invoice_line_id: ids[j], quantity: num(qty[j]), condition: cond[j] });
      }
      if (!cl.length) fail('حدد كمية مرتجعة لصنف واحد على الأقل');
      var cls = await C().sb.from('credit_note_lines').insert(cl);
      if (cls.error && !isDup(cls.error)) fail(cls.error);
      must(await C().sb.rpc('post_credit_note', { p_credit_note_id: cid }));
      st.invoice = null;
      return C().toast('تم ترحيل الإشعار الدائن');
    }
    if (kind === 'expense') {
      var ex = await C().sb.from('expenses').insert({ id: f.get('id'), expense_date: f.get('expense_date') || today(),
        category_code: f.get('category_code'), load_id: f.get('load_id') || null, currency_code: 'SAR', fx_rate: 1,
        amount_original: num(f.get('amount')), description: String(f.get('description') || '').trim() || null,
        client_request_id: f.get('id'), created_by: uidSession() });
      if (ex.error && !isDup(ex.error)) fail(ex.error);
      return C().toast('تم حفظ المصروف');
    }
  }

  async function invoiceCustomer(invId) {
    var r = await C().sb.from('sales_invoices').select('customer_id').eq('id', invId).single();
    if (r.error) fail(r.error);
    return r.data.customer_id;
  }

  function linesFromForm(f) {
    var pids = f.getAll('product_id'), units = f.getAll('unit'), qs = f.getAll('quantity'), ps = f.getAll('unit_price');
    var lines = [];
    for (var i = 0; i < pids.length; i++) {
      if (!(num(qs[i]) > 0)) continue;
      lines.push({ product_id: pids[i], unit: units[i], quantity: num(qs[i]), unit_price: num(ps[i]) });
    }
    if (!lines.length) fail('أضف صنفاً واحداً على الأقل بكمية أكبر من صفر');
    return lines;
  }

  async function click(a, btn) {
    var id = btn.getAttribute('data-id');
    if (a === 'adj-approve') { must(await C().sb.rpc('approve_stock_adjustment', { p_adjustment_id: id })); return C().toast('تم اعتماد التسوية'); }
    if (a === 'inv-edit') { st.editInv = id; return C().refresh(); }
    if (a === 'inv-cancel-edit') { st.editInv = null; return C().refresh(); }
    if (a === 'exp-reverse') {
      var reason = prompt('سبب التصحيح (إلزامي):');
      if (reason === null) return;
      if (reason.trim().length < 3) fail('سبب التصحيح مطلوب');
      must(await C().sb.rpc('reverse_expense', { p_expense_id: id, p_reason: reason.trim() }));
      return C().toast('تم تسجيل القيد العكسي');
    }
    if (a === 'purge-open') {
      var counts = must(await C().sb.rpc('count_test_data'));
      st.purge = counts;
      return C().refresh();
    }
    if (a === 'purge-run') {
      var typed = document.getElementById('purgeConfirm');
      if (!typed || typed.value.trim() !== 'TEST') fail('اكتب كلمة TEST بالضبط للتأكيد');
      if (!confirm('سيُحذف كل ما هو موسوم بـ TEST نهائياً. هل أنت متأكد؟')) return;
      var res = must(await C().sb.rpc('purge_test_data'));
      st.purge = null;
      C().toast('تم حذف بيانات TEST');
      return C().refresh();
    }
    if (a === 'line-add') {
      var holder = document.getElementById('invLines');
      if (holder) { var t = document.createElement('div'); t.innerHTML = invLineHTML(st.products || []); holder.appendChild(t.firstChild); }
      return;
    }
    if (a === 'inv-post') { must(await C().sb.rpc('post_sales_invoice', { p_invoice_id: id })); return C().toast('تم ترحيل الفاتورة'); }
    if (a === 'inv-del') {
      if (!confirm('إلغاء المسودة وتحرير حجز أصنافها؟')) return;
      must(await C().sb.rpc('delete_sales_draft', { p_invoice_id: id }));
      if (st.editInv === id) st.editInv = null;
      return C().toast('تم إلغاء المسودة وتحرير الحجز');
    }
  }

  // ---------- التسجيل ----------
  window.OpsPages = window.OpsPages || {};
  Object.assign(window.OpsPages, P);
  window.OpsExt = { submit: submit, click: click };
})();
