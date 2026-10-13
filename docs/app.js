/* Group Signup — front end. One Apps Script backend per course, chosen by ?c=<key>. */
(function () {
  'use strict';

  var CONFIG = window.GROUP_SIGNUP_CONFIG || {};
  var COURSES = normalizeCourses(CONFIG.COURSES || {});
  var DEMO = Object.keys(COURSES).length === 0;

  var $ = function (sel) { return document.querySelector(sel); };
  var state = { course: null, settings: null, assignments: [], me: null };
  var courseKey = '';
  var apiUrl = '';
  var token = '';
  var assignmentId = '';
  var admin = { key: '', data: null };

  function normalizeCourses(raw) {
    var out = {};
    Object.keys(raw).forEach(function (k) {
      var v = raw[k];
      if (typeof v === 'string') v = { url: v };
      if (v && v.url) out[k] = { url: String(v.url).trim(), label: String(v.label || k) };
    });
    return out;
  }

  // -------------------------------------------------------------------------
  // Storage helpers (localStorage can throw in private windows)
  // -------------------------------------------------------------------------
  function storageGet(store, key) { try { return store.getItem(key) || ''; } catch (e) { return ''; } }
  function storageSet(store, key, value) { try { store.setItem(key, value); } catch (e) { /* ignore */ } }
  function storageDel(store, key) { try { store.removeItem(key); } catch (e) { /* ignore */ } }
  function tokenKey() { return 'groupSignup.token.' + courseKey; }
  function adminKeyKey() { return 'groupSignup.adminKey.' + courseKey; }

  // -------------------------------------------------------------------------
  // API
  // -------------------------------------------------------------------------
  function api(payload) {
    if (DEMO) return demoApi(payload);
    // A string body with no custom headers is a "simple" request, so the browser
    // sends no CORS preflight — which Apps Script web apps cannot answer.
    return fetch(apiUrl, { method: 'POST', body: JSON.stringify(payload) })
      .then(function (res) {
        if (!res.ok) throw new Error('The server returned an error (' + res.status + '). Try again in a moment.');
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.ok) throw new Error((data && data.error) || 'Something went wrong.');
        return data;
      });
  }

  function applyResponse(data) {
    if (data.course) state.course = data.course;
    if (data.settings) state.settings = data.settings;
    if (data.assignments) state.assignments = data.assignments;
    if ('me' in data) state.me = data.me;
    ensureAssignment();
    render();
  }

  // -------------------------------------------------------------------------
  // URL state
  // -------------------------------------------------------------------------
  function readUrl() {
    var url = new URL(location.href);
    courseKey = (url.searchParams.get('c') || '').trim();
    assignmentId = (url.searchParams.get('a') || '').trim();
    var fromUrl = url.searchParams.get('t');

    if (DEMO) courseKey = 'demo';
    else if (!courseKey && Object.keys(COURSES).length === 1) courseKey = Object.keys(COURSES)[0];

    if (fromUrl && courseKey) {
      setToken(fromUrl.trim());
      url.searchParams.delete('t');
      try { history.replaceState(null, '', url.pathname + url.search + url.hash); } catch (e) { /* ignore */ }
    } else if (courseKey) {
      token = storageGet(localStorage, tokenKey());
    }
  }

  function writeUrl() {
    var url = new URL(location.href);
    if (!DEMO) url.searchParams.set('c', courseKey);
    if (assignmentId) url.searchParams.set('a', assignmentId); else url.searchParams.delete('a');
    try { history.replaceState(null, '', url.pathname + url.search + url.hash); } catch (e) { /* ignore */ }
  }

  function ensureAssignment() {
    var list = state.assignments;
    if (!list.length) { assignmentId = ''; return; }
    if (!findAssignment(assignmentId)) {
      var firstOpen = list.filter(function (a) { return a.signupOpen; })[0];
      assignmentId = (firstOpen || list[0]).id;
    }
    writeUrl();
  }

  function selectAssignment(id) {
    assignmentId = id;
    writeUrl();
    notify('');
    render();
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  function render() {
    var c = state.course || {};
    var title = c.name || 'Group Signup';
    document.title = (c.code ? c.code + ' ' : '') + title;
    $('#course-code').textContent = [c.code, [c.term, c.year].filter(Boolean).join(' '), c.section ? 'Section ' + c.section : ''].filter(Boolean).join(' · ');
    $('#course-title').textContent = title;
    $('#course-meta').textContent = c.professor ? c.professor : '';
    $('#admin-open').hidden = false;
    renderAssignmentNav();
    renderAssignment();
    renderIdentity();
    renderGroups();
    $('#groups').setAttribute('aria-busy', 'false');
  }

  function renderAssignmentNav() {
    var nav = $('#assignment-nav');
    nav.textContent = '';
    nav.hidden = state.assignments.length < 2;
    state.assignments.forEach(function (a) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('aria-current', a.id === assignmentId ? 'true' : 'false');
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = a.name;
      var sub = document.createElement('span');
      sub.className = 'sub';
      var bits = [];
      if (a.due) bits.push('Due ' + formatDate(a.due, true));
      var mine = state.me && state.me.selections[a.id];
      var g = mine ? findGroup(a, mine) : null;
      bits.push(g ? 'You: ' + g.name : (a.signupOpen ? 'Open' : 'Closed'));
      sub.textContent = bits.join(' · ');
      btn.appendChild(name);
      btn.appendChild(sub);
      btn.addEventListener('click', function () { selectAssignment(a.id); });
      nav.appendChild(btn);
    });
  }

  function renderAssignment() {
    var section = $('#assignment');
    var a = findAssignment(assignmentId);
    section.hidden = !a;
    if (!a) return;
    var h = $('#assignment-title');
    h.textContent = a.name;
    var chip = document.createElement('span');
    chip.className = 'chip ' + (a.signupOpen ? 'open' : 'closed');
    chip.textContent = a.signupOpen ? 'Signup open' : 'Signup closed';
    h.appendChild(chip);

    var meta = [];
    if (a.due) meta.push('Due ' + formatDate(a.due));
    if (a.signupOpen && a.signupCloses) meta.push('Signup closes ' + formatDate(a.signupCloses));
    if (!a.signupOpen && a.closedReason) meta.push(a.closedReason);
    $('#assignment-meta').textContent = meta.join(' · ');
    $('#assignment-instructions').textContent = a.instructions || '';
  }

  function renderIdentity() {
    var box = $('#identity');
    box.textContent = '';
    var s = state.settings || {};
    var a = findAssignment(assignmentId);

    if (state.me) {
      var h = document.createElement('h2');
      h.textContent = 'Hi, ' + state.me.name;
      var p = document.createElement('p');
      if (a) {
        var g = findGroup(a, state.me.selections[a.id]);
        p.textContent = g
          ? 'For ' + a.name + ' you are in ' + g.name + '.' + (a.signupOpen ? ' You can switch or leave while signup is open.' : '')
          : 'You have not chosen a group for ' + a.name + ' yet.' + (a.signupOpen ? ' Pick one below.' : '');
      } else {
        p.textContent = 'No assignments are set up yet.';
      }
      box.appendChild(h);
      box.appendChild(p);
      if (s.openEnrollment) box.appendChild(personalLink());
      return;
    }

    if (token) {
      var bad = document.createElement('p');
      bad.textContent = 'Your personal link was not recognised. Ask the instructor to resend it.';
      box.appendChild(bad);
      var clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'link-button';
      clear.textContent = 'Forget this link';
      clear.addEventListener('click', function () { setToken(''); load(); });
      box.appendChild(clear);
      return;
    }

    if (s.openEnrollment) {
      box.appendChild(registerForm());
      return;
    }

    var need = document.createElement('p');
    need.textContent = 'To join a group, open the personal link your instructor emailed you. You can browse the groups in the meantime.';
    box.appendChild(need);
  }

  function registerForm() {
    var form = document.createElement('form');
    form.innerHTML =
      '<h2>Get started</h2>' +
      '<p class="hint">Enter your details once. Your browser will remember you on this device.</p>' +
      '<label>Name <input name="name" type="text" autocomplete="name" required></label>' +
      '<label>Email <input name="email" type="email" autocomplete="email" required></label>' +
      '<div><button type="submit" class="button primary">Continue</button></div>';
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var btn = form.querySelector('button');
      btn.disabled = true;
      api({ action: 'register', name: form.name.value, email: form.email.value })
        .then(function (data) {
          setToken(data.token);
          applyResponse(data);
          notify('You are registered. Bookmark your personal link to use another device.', 'success');
        })
        .catch(function (err) { notify(err.message, 'error'); btn.disabled = false; });
    });
    return form;
  }

  function personalLink() {
    var wrap = document.createElement('div');
    wrap.className = 'personal-link';
    var label = document.createElement('span');
    label.className = 'hint';
    label.textContent = 'Your personal link (for another device):';
    var code = document.createElement('code');
    var link = location.origin + location.pathname + '?' + (DEMO ? '' : 'c=' + encodeURIComponent(courseKey) + '&') + 't=' + encodeURIComponent(token);
    code.textContent = link;
    var copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'button';
    copy.textContent = 'Copy';
    copy.addEventListener('click', function () {
      if (navigator.clipboard) navigator.clipboard.writeText(link).then(function () { copy.textContent = 'Copied'; });
    });
    wrap.appendChild(label);
    wrap.appendChild(code);
    wrap.appendChild(copy);
    return wrap;
  }

  function renderGroups() {
    var container = $('#groups');
    container.textContent = '';
    var a = findAssignment(assignmentId);
    var me = state.me;
    var myDisplay = me ? displayNameLike(me.name) : null;

    if (!a) {
      var none = document.createElement('p');
      none.className = 'hint';
      none.textContent = 'No assignments have been set up yet.';
      container.appendChild(none);
      return;
    }
    if (!a.groups.length) {
      var empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'No groups have been set up for this assignment yet.';
      container.appendChild(empty);
      return;
    }

    var myGroupId = me ? me.selections[a.id] : null;

    a.groups.forEach(function (g) {
      var mine = myGroupId === g.id;
      var unlimited = !g.slots || g.slots <= 0;
      var full = !unlimited && g.filled >= g.slots;

      var card = document.createElement('article');
      card.className = 'card' + (mine ? ' mine' : '');

      var h = document.createElement('h3');
      h.textContent = g.name;
      if (mine) {
        var badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = 'Your group';
        h.appendChild(badge);
      }
      card.appendChild(h);

      if (g.description) {
        var d = document.createElement('p');
        d.className = 'desc';
        d.textContent = g.description;
        card.appendChild(d);
      }

      var cap = document.createElement('div');
      cap.className = 'capacity';
      var capText = document.createElement('span');
      capText.textContent = unlimited
        ? g.filled + ' joined'
        : g.filled + ' of ' + g.slots + ' spots filled' + (full ? ' — full' : '');
      cap.appendChild(capText);
      if (!unlimited) {
        var meter = document.createElement('div');
        meter.className = 'meter' + (full ? ' full' : '');
        meter.setAttribute('role', 'img');
        meter.setAttribute('aria-label', capText.textContent);
        var fill = document.createElement('span');
        fill.style.width = Math.min(100, Math.round(100 * g.filled / g.slots)) + '%';
        meter.appendChild(fill);
        cap.appendChild(meter);
      }
      card.appendChild(cap);

      var list = document.createElement('ul');
      list.className = 'members';
      list.setAttribute('aria-label', 'Members of ' + g.name);
      if (!g.members.length) {
        var li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'No one yet';
        list.appendChild(li);
      } else {
        var highlighted = false;
        g.members.forEach(function (name) {
          var item = document.createElement('li');
          item.textContent = name;
          if (mine && !highlighted && (name === me.name || name === myDisplay)) {
            item.className = 'me';
            highlighted = true;
          }
          list.appendChild(item);
        });
      }
      card.appendChild(list);

      if (me) {
        var actions = document.createElement('div');
        actions.className = 'card-actions';
        var btn = document.createElement('button');
        btn.type = 'button';
        if (mine) {
          btn.className = 'button danger';
          btn.textContent = 'Leave group';
          btn.disabled = !a.signupOpen;
          btn.addEventListener('click', function () {
            act({ action: 'leave', token: token, assignmentId: a.id }, 'You left ' + g.name + '.');
          });
        } else {
          btn.className = 'button primary';
          btn.textContent = myGroupId ? 'Switch to this group' : 'Join';
          btn.disabled = !a.signupOpen || full;
          btn.addEventListener('click', function () {
            act({ action: 'join', token: token, assignmentId: a.id, groupId: g.id }, 'You joined ' + g.name + '.');
          });
        }
        actions.appendChild(btn);
        card.appendChild(actions);
      }

      container.appendChild(card);
    });
  }

  function act(payload, successMessage) {
    setBusy(true);
    api(payload)
      .then(function (data) { applyResponse(data); notify(successMessage, 'success'); })
      .catch(function (err) { notify(err.message, 'error'); load(); });
  }

  function findAssignment(id) {
    return state.assignments.filter(function (a) { return a.id === id; })[0] || null;
  }

  function findGroup(assignment, id) {
    if (!assignment || !id) return null;
    return assignment.groups.filter(function (g) { return g.id === id; })[0] || null;
  }

  function displayNameLike(name) {
    var parts = String(name || '').trim().split(/\s+/);
    if (parts.length < 2) return name;
    return parts[0] + ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.';
  }

  function formatDate(value, short) {
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    // Date-only strings like 2026-10-31 parse as UTC midnight; show them as a date, not a time.
    var dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim());
    if (dateOnly) d = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    var opts = (dateOnly || short) ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' };
    return d.toLocaleString(undefined, opts);
  }

  function setBusy(busy) { $('#groups').setAttribute('aria-busy', busy ? 'true' : 'false'); }

  function notify(message, kind) {
    var n = $('#notice');
    n.textContent = message;
    n.className = 'notice ' + (kind || '');
    n.hidden = !message;
  }

  function setToken(value) {
    token = value || '';
    if (token) storageSet(localStorage, tokenKey(), token); else storageDel(localStorage, tokenKey());
  }

  function load() {
    setBusy(true);
    api({ action: 'state', token: token })
      .then(applyResponse)
      .catch(function (err) {
        $('#course-meta').textContent = 'Could not load the signup data.';
        notify(err.message, 'error');
        setBusy(false);
      });
  }

  function renderCourseChooser(message) {
    var chooser = $('#course-chooser');
    var list = $('#course-list');
    list.textContent = '';
    Object.keys(COURSES).forEach(function (k) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '?c=' + encodeURIComponent(k);
      a.textContent = COURSES[k].label;
      li.appendChild(a);
      list.appendChild(li);
    });
    chooser.hidden = false;
    $('#course-meta').textContent = message || '';
    $('#groups').setAttribute('aria-busy', 'false');
  }

  // -------------------------------------------------------------------------
  // Instructor panel
  // -------------------------------------------------------------------------
  function initAdmin() {
    var dialog = $('#admin-dialog');
    var login = $('#admin-login');
    var body = $('#admin-body');

    $('#admin-open').addEventListener('click', function () {
      admin.key = storageGet(sessionStorage, adminKeyKey());
      if (admin.key) adminLoad(); else showLogin();
      dialog.showModal();
    });

    login.addEventListener('submit', function (ev) {
      ev.preventDefault();
      admin.key = $('#admin-key').value.trim();
      adminLoad();
    });

    $('#admin-refresh').addEventListener('click', adminLoad);
    $('#admin-forget').addEventListener('click', function () {
      admin.key = '';
      admin.data = null;
      storageDel(sessionStorage, adminKeyKey());
      showLogin();
    });
    $('#admin-download').addEventListener('click', function () {
      if (!admin.data) return;
      var header = admin.data.rows[0];
      var rows = admin.data.rows.slice(1).filter(function (r) { return r[2] === assignmentId; });
      downloadCsv(toCsv([header].concat(rows)), assignmentId);
    });
    $('#admin-download-all').addEventListener('click', function () {
      if (!admin.data) return;
      downloadCsv(admin.data.csv, 'all');
    });

    function downloadCsv(csv, suffix) {
      var code = (state.course && state.course.code) || 'course';
      var name = (code + '_' + suffix + '_signups_' + new Date().toISOString().slice(0, 10)).replace(/[^\w\-]+/g, '_') + '.csv';
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }

    function showLogin() {
      login.hidden = false;
      body.hidden = true;
      $('#admin-key').value = '';
    }

    function adminLoad() {
      api({ action: 'export', adminKey: admin.key })
        .then(function (data) {
          admin.data = data;
          storageSet(sessionStorage, adminKeyKey(), admin.key);
          login.hidden = true;
          body.hidden = false;
          renderAdmin(data);
        })
        .catch(function (err) {
          showLogin();
          notify(err.message, 'error');
        });
    }

    function renderAdmin(data) {
      var a = findAssignment(assignmentId);
      var rows = data.rows.slice(1).filter(function (r) { return r[2] === assignmentId; });
      var tbody = $('#admin-table tbody');
      tbody.textContent = '';
      rows.forEach(function (r) {
        var tr = document.createElement('tr');
        [r[0], r[1], r[5] || '—', r[6] || ''].forEach(function (c) {
          var td = document.createElement('td');
          td.textContent = c;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      var chosen = rows.filter(function (r) { return r[4]; }).length;
      var perGroup = a ? a.groups.map(function (g) {
        return g.name + ': ' + g.filled + (g.slots > 0 ? '/' + g.slots : '');
      }).join(' · ') : '';
      $('#admin-summary').textContent = (a ? a.name + ' — ' : '') + rows.length + ' on roster, ' + chosen + ' have chosen. ' + perGroup;
    }
  }

  function toCsv(rows) {
    return rows.map(function (r) {
      return r.map(function (c) {
        var v = String(c == null ? '' : c);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',');
    }).join('\n');
  }

  // -------------------------------------------------------------------------
  // Demo backend (used only when no course is configured)
  // -------------------------------------------------------------------------
  function demoApi(payload) {
    var db = demoApi.db || (demoApi.db = {
      course: { name: 'Canadian Politics', code: 'POL 2230', year: '2026', term: 'Fall', section: '001', professor: 'Prof. Example' },
      settings: { signupOpen: true, openEnrollment: true },
      assignments: [
        { id: 'presentations', name: 'Seminar presentations', due: '2026-11-06', signupCloses: '2026-10-30T23:59', open: true,
          instructions: 'Each group presents for 15 minutes on its assigned week.\nSign up for one slot. Groups of up to four.',
          groups: [
            { id: 'w5', name: 'Week 5 — Federalism', slots: 4, description: 'Oct 9' },
            { id: 'w6', name: 'Week 6 — Parliament', slots: 4, description: 'Oct 16' },
            { id: 'w7', name: 'Week 7 — Courts', slots: 3, description: 'Oct 23' }
          ] },
        { id: 'debates', name: 'Policy debates', due: '2026-11-27', signupCloses: '', open: true,
          instructions: 'Pick a side. The instructor will pair pro and con teams.',
          groups: [
            { id: 'pro', name: 'Pro side', slots: 0, description: 'No cap.' },
            { id: 'con', name: 'Con side', slots: 0, description: 'No cap.' }
          ] },
        { id: 'essay', name: 'Peer review pairs', due: '2026-12-04', signupCloses: '', open: false,
          instructions: 'Opens after reading week.',
          groups: [{ id: 'p1', name: 'Pair 1', slots: 2, description: '' }, { id: 'p2', name: 'Pair 2', slots: 2, description: '' }] }
      ],
      roster: [
        { email: 'ada@example.com', name: 'Ada Lovelace', token: 'demo-ada' },
        { email: 'grace@example.com', name: 'Grace Hopper', token: 'demo-grace' },
        { email: 'alan@example.com', name: 'Alan Turing', token: 'demo-alan' },
        { email: 'katherine@example.com', name: 'Katherine Johnson', token: 'demo-kat' }
      ],
      signups: { 'ada@example.com|presentations': 'w5', 'grace@example.com|presentations': 'w5', 'alan@example.com|presentations': 'w7',
                 'katherine@example.com|presentations': 'w7', 'ada@example.com|debates': 'pro' }
    });

    function who(t) { return db.roster.filter(function (r) { return r.token === t; })[0] || null; }
    function closedReason(a) {
      if (!db.settings.signupOpen) return 'Signup is currently closed for all assignments.';
      if (!a.open) return 'Signup for this assignment is closed.';
      if (a.signupCloses && new Date() > new Date(a.signupCloses)) return 'The signup deadline for this assignment has passed.';
      return '';
    }
    function assignments() {
      return db.assignments.map(function (a) {
        var reason = closedReason(a);
        return {
          id: a.id, name: a.name, due: a.due, signupCloses: a.signupCloses, instructions: a.instructions,
          signupOpen: !reason, closedReason: reason,
          groups: a.groups.map(function (g) {
            var members = db.roster.filter(function (r) { return db.signups[r.email + '|' + a.id] === g.id; })
              .map(function (r) { return displayNameLike(r.name); }).sort();
            return { id: g.id, name: g.name, slots: g.slots, description: g.description, filled: members.length, members: members };
          })
        };
      });
    }
    function me(r) {
      var sel = {};
      db.assignments.forEach(function (a) { var g = db.signups[r.email + '|' + a.id]; if (g) sel[a.id] = g; });
      return { email: r.email, name: r.name, selections: sel };
    }
    function ok(extra) { return Promise.resolve(Object.assign({ ok: true, course: db.course, settings: db.settings, assignments: assignments() }, extra)); }
    function fail(msg) { return Promise.reject(new Error(msg)); }

    var r = who(payload.token);
    var a = db.assignments.filter(function (x) { return x.id === payload.assignmentId; })[0];
    switch (payload.action) {
      case 'state':
        return ok({ me: r ? me(r) : null });
      case 'register': {
        var email = String(payload.email || '').trim().toLowerCase();
        if (db.roster.some(function (x) { return x.email === email; })) return fail('That email is already registered (demo).');
        var nr = { email: email, name: String(payload.name || '').trim(), token: 'demo-' + Math.random().toString(36).slice(2, 10) };
        db.roster.push(nr);
        return ok({ token: nr.token, me: me(nr) });
      }
      case 'join': {
        if (!r) return fail('Your link is not recognised (demo).');
        if (!a) return fail('That assignment does not exist.');
        var reason = closedReason(a);
        if (reason) return fail(reason);
        var g = a.groups.filter(function (x) { return x.id === payload.groupId; })[0];
        if (!g) return fail('That group does not exist.');
        var key = r.email + '|' + a.id;
        var filled = Object.keys(db.signups).filter(function (k) { return k.split('|')[1] === a.id && db.signups[k] === g.id; }).length;
        if (g.slots > 0 && filled >= g.slots && db.signups[key] !== g.id) return fail('Sorry, "' + g.name + '" is full.');
        db.signups[key] = g.id;
        return ok({ me: me(r) });
      }
      case 'leave':
        if (!r) return fail('Your link is not recognised (demo).');
        if (!a) return fail('That assignment does not exist.');
        if (closedReason(a)) return fail(closedReason(a));
        delete db.signups[r.email + '|' + a.id];
        return ok({ me: me(r) });
      case 'export': {
        if (payload.adminKey !== 'demo') return fail('Wrong admin key. (In demo mode the key is "demo".)');
        var rows = [['email', 'name', 'assignment_id', 'assignment_name', 'group_id', 'group_name', 'updated']];
        db.roster.forEach(function (x) {
          db.assignments.forEach(function (asg) {
            var gid = db.signups[x.email + '|' + asg.id] || '';
            var gg = asg.groups.filter(function (y) { return y.id === gid; })[0];
            rows.push([x.email, x.name, asg.id, asg.name, gid, gg ? gg.name : '', gid ? new Date().toISOString().slice(0, 16).replace('T', ' ') : '']);
          });
        });
        return ok({ rows: rows, csv: toCsv(rows) });
      }
      default:
        return fail('Unknown action.');
    }
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    if (DEMO) $('#demo-banner').hidden = false;
    readUrl();
    initAdmin();

    if (!DEMO) {
      if (!courseKey) return renderCourseChooser('');
      if (!COURSES[courseKey]) return renderCourseChooser('The course "' + courseKey + '" is not in this site\'s configuration.');
      apiUrl = COURSES[courseKey].url;
    }
    load();
  });
})();
