/* Group Signup — front end. One Apps Script backend per course, chosen by ?c=<key>.
 * The same script runs index.html (group signup) and attend.html (attendance check-in);
 * the page is told apart by <body data-page>. */
(function () {
  'use strict';

  var CONFIG = window.GROUP_SIGNUP_CONFIG || {};
  var COURSES = normalizeCourses(CONFIG.COURSES || {});
  var FORCE_DEMO = /[?&]demo=1(&|$)/.test(location.search); // try the sample data even when courses are configured
  var DEMO = Object.keys(COURSES).length === 0 || FORCE_DEMO;
  var ATTEND = document.body.getAttribute('data-page') === 'attend';

  var $ = function (sel) { return document.querySelector(sel); };
  var state = { course: null, settings: null, assignments: [], me: null, roster: null, session: null, checkedIn: null, history: [] };
  var courseKey = '';
  var apiUrl = '';
  var token = '';
  var assignmentId = '';
  var attendCode = '';   // class code carried by the QR code's URL (?k=1234)
  var admin = { key: '', data: null, config: null, assignments: null };

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

  /** A random id that stays with this browser, so two students checking in from one phone can be flagged. */
  function deviceId() {
    var id = storageGet(localStorage, 'groupSignup.device');
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
      storageSet(localStorage, 'groupSignup.device', id);
    }
    return id;
  }

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
    if ('session' in data) state.session = data.session;
    if ('checkedIn' in data) state.checkedIn = data.checkedIn;
    if (data.history) state.history = data.history;
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
    var codeFromUrl = url.searchParams.get('k');
    var changed = false;

    if (DEMO) courseKey = 'demo';
    else if (!courseKey && Object.keys(COURSES).length === 1) courseKey = Object.keys(COURSES)[0];

    if (fromUrl && courseKey) {
      setToken(fromUrl.trim());
      url.searchParams.delete('t');
      changed = true;
    } else if (courseKey) {
      token = storageGet(localStorage, tokenKey());
    }
    if (codeFromUrl !== null) {
      attendCode = codeFromUrl.replace(/\D/g, '');
      url.searchParams.delete('k');
      changed = true;
    }
    if (changed) {
      try { history.replaceState(null, '', url.pathname + url.search + url.hash); } catch (e) { /* ignore */ }
    }
  }

  function writeUrl() {
    if (ATTEND) return;
    var url = new URL(location.href);
    if (!DEMO) url.searchParams.set('c', courseKey);
    if (assignmentId) url.searchParams.set('a', assignmentId); else url.searchParams.delete('a');
    try { history.replaceState(null, '', url.pathname + url.search + url.hash); } catch (e) { /* ignore */ }
  }

  /** URL of a page in this site for the current course, e.g. pageUrl('attend.html', { k: '1234' }). */
  function pageUrl(page, params) {
    var base = location.origin + location.pathname.replace(/[^/]*$/, '') + page;
    var q = [];
    if (!DEMO) q.push('c=' + encodeURIComponent(courseKey));
    if (FORCE_DEMO) q.push('demo=1');
    Object.keys(params || {}).forEach(function (k) { if (params[k]) q.push(k + '=' + encodeURIComponent(params[k])); });
    return base + (q.length ? '?' + q.join('&') : '');
  }

  function ensureAssignment() {
    if (ATTEND) return;
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
    if ($('#admin-open')) $('#admin-open').hidden = false;
    if ($('#attend-link')) { $('#attend-link').href = pageUrl('attend.html'); $('#attend-link').hidden = false; }
    if ($('#signup-link')) $('#signup-link').href = pageUrl('index.html');
    renderIdentity();
    if (ATTEND) {
      document.title = (c.code ? c.code + ' ' : '') + 'Attendance';
      renderAttend();
      setBusy(false);
      return;
    }
    renderAssignmentNav();
    renderAssignment();
    renderGroups();
    setBusy(false);
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
      if (ATTEND) return; // the check-in card carries the greeting
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
      box.appendChild(accountActions());
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

    if (s.selfServiceLinks) {
      box.appendChild(findYourName());
      return;
    }

    var need = document.createElement('p');
    need.textContent = ATTEND
      ? 'To check in, open the personal link your instructor emailed you on this phone.'
      : 'To join a group, open the personal link your instructor emailed you. You can browse the groups in the meantime.';
    box.appendChild(need);
  }

  // -------------------------------------------------------------------------
  // Attendance check-in (attend.html)
  // -------------------------------------------------------------------------
  function renderAttend() {
    var box = $('#attend');
    box.textContent = '';
    if (!state.me) { box.hidden = true; return; }
    box.hidden = false;

    var h = document.createElement('h2');
    h.textContent = 'Hi, ' + state.me.name;
    box.appendChild(h);

    var session = state.session;
    if (state.checkedIn) {
      var done = document.createElement('div');
      done.className = 'checked-in';
      var strong = document.createElement('strong');
      strong.textContent = '✓ You’re checked in';
      var when = document.createElement('span');
      when.className = 'when';
      when.textContent = state.checkedIn.label + ' · ' + formatTime(state.checkedIn.time);
      done.appendChild(strong);
      done.appendChild(when);
      box.appendChild(done);
    } else if (session) {
      var p = document.createElement('p');
      p.textContent = 'Check-in is open for ' + session.label + ' until ' + formatTime(session.closes) + '.';
      box.appendChild(p);

      var form = document.createElement('form');
      var input = null;
      if (!attendCode) {
        var lab = document.createElement('label');
        lab.appendChild(document.createTextNode('Class code from the slide'));
        input = document.createElement('input');
        input.className = 'code-input';
        input.type = 'text';
        input.inputMode = 'numeric';
        input.pattern = '[0-9]*';
        input.maxLength = 4;
        input.autocomplete = 'one-time-code';
        input.required = true;
        input.placeholder = '0000';
        lab.appendChild(input);
        form.appendChild(lab);
      }
      var btn = document.createElement('button');
      btn.type = 'submit';
      btn.className = 'button primary big';
      btn.textContent = 'I’m here';
      form.appendChild(btn);
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var code = attendCode || (input ? input.value.replace(/\D/g, '') : '');
        if (!code) { notify('Enter the class code shown on the slide.', 'error'); return; }
        btn.disabled = true;
        setBusy(true);
        api({ action: 'attend', token: token, code: code, device: deviceId() })
          .then(function (data) {
            applyResponse(data);
            notify(state.checkedIn ? 'You’re checked in. You can close this page.' : '', 'success');
          })
          .catch(function (err) {
            attendCode = ''; // a wrong code from the QR must not be retried silently; let the student type it
            notify(err.message, 'error');
            load();
          });
      });
      box.appendChild(form);
      if (input) setTimeout(function () { input.focus(); }, 0);
    } else {
      var none = document.createElement('p');
      none.textContent = 'No check-in is open right now. When your instructor shows the code, scan it or refresh this page.';
      box.appendChild(none);
      var refresh = document.createElement('button');
      refresh.type = 'button';
      refresh.className = 'button';
      refresh.textContent = 'Refresh';
      refresh.addEventListener('click', function () { notify(''); load(); });
      box.appendChild(refresh);
    }

    if (state.history.length) {
      var attended = state.history.filter(function (s) { return s.present; }).length;
      var hist = document.createElement('p');
      hist.className = 'hint';
      hist.textContent = 'Your record so far: present at ' + attended + ' of ' + state.history.length + ' past ' + (state.history.length === 1 ? 'session' : 'sessions') + '.';
      box.appendChild(hist);
    }
    box.appendChild(accountActions());
  }

  function formatTime(value) {
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value || '');
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function accountActions() {
    var wrap = document.createElement('p');
    wrap.className = 'account-actions hint';
    var out = document.createElement('button');
    out.type = 'button';
    out.className = 'link-button';
    out.textContent = 'Not you? Sign out on this device';
    out.addEventListener('click', function () { setToken(''); notify(''); load(); });
    wrap.appendChild(out);
    {
      wrap.appendChild(document.createTextNode(' · '));
      var reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'link-button';
      reset.textContent = 'Email me a fresh link';
      reset.title = 'Replaces your link. Use this if you shared it by mistake or want to sign in elsewhere.';
      reset.addEventListener('click', function () {
        if (!window.confirm('Email you a new personal link? Your current link will stop working, and you will be signed out on this device until you open the new one.')) return;
        reset.disabled = true;
        api({ action: 'resetToken', token: token })
          .then(function (data) {
            setToken('');
            load();
            notify('A new link was emailed to ' + data.sentTo + '. Open it to sign in again. Your group choices are unchanged.', 'success');
          })
          .catch(function (err) { notify(err.message, 'error'); reset.disabled = false; });
      });
      wrap.appendChild(reset);
    }
    return wrap;
  }

  function findYourName() {
    var wrap = document.createElement('div');
    wrap.className = 'find-name';
    wrap.innerHTML =
      '<h2>Find your name</h2>' +
      '<p class="hint">Pick your name and we will email a sign-in link to the address your instructor has on file. ' +
      'Already have a link? Just open it.</p>' +
      '<label class="visually-hidden" for="name-search">Search names</label>' +
      '<input id="name-search" type="search" placeholder="Start typing your name" autocomplete="off">' +
      '<ul class="roster-list" aria-label="Names on the roster"></ul>' +
      '<div class="confirm-send" hidden></div>';
    var input = wrap.querySelector('input');
    var list = wrap.querySelector('ul');
    var confirmBox = wrap.querySelector('.confirm-send');

    function renderList() {
      list.textContent = '';
      if (!state.roster) {
        var li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'Loading names…';
        list.appendChild(li);
        return;
      }
      var q = input.value.trim().toLowerCase();
      var matches = state.roster.filter(function (r) { return !q || r.name.toLowerCase().indexOf(q) >= 0; });
      if (!matches.length) {
        var none = document.createElement('li');
        none.className = 'empty';
        none.textContent = 'No names match. If you are not listed, ask the instructor to add you.';
        list.appendChild(none);
        return;
      }
      matches.forEach(function (r) {
        var li = document.createElement('li');
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = r.name;
        btn.addEventListener('click', function () { askToSend(r); });
        li.appendChild(btn);
        list.appendChild(li);
      });
    }

    function askToSend(r) {
      confirmBox.hidden = false;
      confirmBox.textContent = '';
      var text = document.createElement('p');
      text.textContent = 'Send a sign-in link to the email on file for ' + r.name + '?';
      var row = document.createElement('div');
      row.className = 'row';
      var send = document.createElement('button');
      send.type = 'button';
      send.className = 'button primary';
      send.textContent = 'Send my link';
      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'button';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', function () { confirmBox.hidden = true; });
      send.addEventListener('click', function () {
        send.disabled = true;
        api({ action: 'sendLink', rosterId: r.id })
          .then(function (data) {
            confirmBox.textContent = '';
            var done = document.createElement('p');
            done.textContent = 'Sent to ' + data.sentTo + '. Open the link in that email on this device to sign in. ' +
              'If it has not arrived in a minute or two, check your spam folder.';
            confirmBox.appendChild(done);
            list.hidden = true;
            input.hidden = true;
          })
          .catch(function (err) { notify(err.message, 'error'); send.disabled = false; });
      });
      row.appendChild(send);
      row.appendChild(cancel);
      confirmBox.appendChild(text);
      confirmBox.appendChild(row);
      confirmBox.scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('input', renderList);
    renderList();
    if (!state.roster) {
      api({ action: 'roster' })
        .then(function (data) { state.roster = data.roster; renderList(); })
        .catch(function (err) { notify(err.message, 'error'); });
    }
    return wrap;
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
    // A date cell in the Sheet arrives as midnight; treat that as a date with no time.
    if (!dateOnly && d.getHours() === 0 && d.getMinutes() === 0) dateOnly = true;
    var opts = (dateOnly || short) ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' };
    return d.toLocaleString(undefined, opts);
  }

  function setBusy(busy) {
    var el = $('#groups') || $('#attend');
    if (el) el.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

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
    api({ action: ATTEND ? 'attendState' : 'state', token: token })
      .then(applyResponse)
      .catch(function (err) {
        $('#course-meta').textContent = ATTEND ? 'Could not load the attendance page.' : 'Could not load the signup data.';
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
    setBusy(false);
  }

  // -------------------------------------------------------------------------
  // Instructor panel
  // -------------------------------------------------------------------------
  function initAdmin() {
    var dialog = $('#admin-dialog');
    if (!dialog) return; // the check-in page has no instructor panel
    var login = $('#admin-login');
    var body = $('#admin-body');
    var attendance = { data: null, sessionId: '', timer: null, ticks: 0 };

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
      admin.config = null;
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

    document.querySelectorAll('.admin-tabs button[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () { showTab(btn.getAttribute('data-tab')); });
    });
    $('#admin-add-assignment').addEventListener('click', function () {
      admin.assignments.push({ id: '', name: '', due: '', signupCloses: '', open: true, instructions: '', groups: [], isNew: true });
      renderAssignmentsEditor();
      var editors = document.querySelectorAll('.assignment-editor');
      var last = editors[editors.length - 1];
      if (last) { last.open = true; var first = last.querySelector('input'); if (first) first.focus(); }
    });
    $('#admin-save-assignments').addEventListener('click', function () {
      var payload = admin.assignments.map(function (a) {
        return { id: a.id, name: a.name, due: a.due, signupCloses: a.signupCloses, open: a.open, instructions: a.instructions,
          groups: a.groups.map(function (g) { return { id: g.id, name: g.name, slots: g.slots, description: g.description }; }) };
      });
      adminSave({ action: 'adminSaveAssignments', assignments: payload }, 'Assignments saved.');
    });
    $('#admin-save-roster').addEventListener('click', function () {
      var roster = parseRosterText($('#admin-roster').value);
      adminSave({ action: 'adminSaveRoster', roster: roster, removeMissing: $('#admin-roster-remove').checked }, 'Roster saved.');
    });
    $('#admin-roster').addEventListener('input', function () {
      $('#admin-roster-count').textContent = parseRosterText($('#admin-roster').value).length + ' listed';
    });

    $('#admin-attendance-refresh').addEventListener('click', attendanceLoad);
    $('#admin-session-select').addEventListener('change', function () {
      attendance.sessionId = $('#admin-session-select').value;
      renderAttendanceTable();
    });
    $('#admin-attendance-download').addEventListener('click', function () {
      if (!attendance.data) return;
      downloadCsv(attendanceCsv(attendance.data), 'attendance');
    });
    dialog.addEventListener('close', stopAttendanceTimer);

    function showTab(name) {
      document.querySelectorAll('.admin-tabs button[data-tab]').forEach(function (b) {
        b.setAttribute('aria-current', b.getAttribute('data-tab') === name ? 'true' : 'false');
      });
      document.querySelectorAll('#admin-body section[data-panel]').forEach(function (sec) {
        sec.hidden = sec.getAttribute('data-panel') !== name;
      });
      if (name === 'attendance') {
        if (!attendance.data) attendanceLoad();
        startAttendanceTimer();
      } else {
        stopAttendanceTimer();
      }
    }

    function showLogin() {
      login.hidden = false;
      body.hidden = true;
      $('#admin-key').value = '';
      attendance.data = null;
      stopAttendanceTimer();
    }

    // --- Attendance tab ---------------------------------------------------

    function attendanceLoad() {
      return attendanceCall({ action: 'adminAttendance' });
    }

    function attendanceCall(payload, successMessage) {
      payload.adminKey = admin.key;
      return api(payload)
        .then(function (data) {
          attendance.data = data;
          var open = openSessionOf(data);
          if (data.started) attendance.sessionId = data.started;
          else if (!attendance.sessionId || !data.sessions.some(function (s) { return s.id === attendance.sessionId; })) {
            attendance.sessionId = open ? open.id : (data.sessions[0] ? data.sessions[0].id : '');
          }
          renderAttendance();
          if (successMessage) adminNotify(successMessage, 'success');
        })
        .catch(function (err) { adminNotify(err.message, 'error'); });
    }

    function openSessionOf(data) {
      return data.sessions.filter(function (s) { return s.open; })[0] || null;
    }

    /** Refresh every 10 s while a session is open; tick the countdown every second. */
    function startAttendanceTimer() {
      stopAttendanceTimer();
      attendance.ticks = 0;
      attendance.timer = setInterval(function () {
        attendance.ticks++;
        renderCountdown();
        if (attendance.ticks % 10 === 0 && attendance.data && openSessionOf(attendance.data) && !document.hidden) attendanceLoad();
      }, 1000);
    }

    function stopAttendanceTimer() {
      if (attendance.timer) clearInterval(attendance.timer);
      attendance.timer = null;
    }

    function renderAttendance() {
      renderSessionLive();
      renderSessionSelect();
      renderAttendanceTable();
    }

    function renderSessionLive() {
      var data = attendance.data;
      var box = $('#admin-session-live');
      box.textContent = '';
      var open = openSessionOf(data);
      box.className = 'session-live' + (open ? ' open' : '');

      if (open) {
        var h = document.createElement('h3');
        h.textContent = 'Check-in open: ' + open.label;
        box.appendChild(h);

        var row = document.createElement('div');
        row.className = 'live-row';
        var code = document.createElement('div');
        code.className = 'session-code';
        code.textContent = open.code;
        code.title = 'Class code';
        row.appendChild(code);
        row.appendChild(stat('Checked in', String(open.present) + ' of ' + data.roster.length));
        var cdStat = stat('Closes in', '');
        cdStat.querySelector('strong').id = 'admin-countdown';
        row.appendChild(cdStat);
        if (open.flagged) row.appendChild(stat('Flagged', String(open.flagged)));
        box.appendChild(row);

        var actions = document.createElement('div');
        actions.className = 'admin-actions';
        var show = document.createElement('a');
        show.className = 'button primary';
        show.textContent = 'Show on screen';
        show.href = displayUrl(open);
        show.target = '_blank';
        show.rel = 'noopener';
        actions.appendChild(show);
        var extend = document.createElement('button');
        extend.type = 'button';
        extend.className = 'button';
        extend.textContent = 'Extend 5 min';
        extend.addEventListener('click', function () {
          attendanceCall({ action: 'adminExtendSession', sessionId: open.id, minutes: 5 }, 'Extended by 5 minutes.');
        });
        actions.appendChild(extend);
        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'button danger';
        close.textContent = 'Close now';
        close.addEventListener('click', function () {
          attendanceCall({ action: 'adminCloseSession', sessionId: open.id }, 'Check-in closed.');
        });
        actions.appendChild(close);
        var link = document.createElement('span');
        link.className = 'hint';
        link.textContent = 'Students without a camera: ' + pageUrl('attend.html').replace(/^https?:\/\//, '') + ' and code ' + open.code;
        actions.appendChild(link);
        box.appendChild(actions);
        renderCountdown();
        return;
      }

      var title = document.createElement('h3');
      title.textContent = 'Start check-in';
      box.appendChild(title);
      var hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'A 4-digit class code is generated and shown with a QR code for your slide. Students on the roster tap once to check in; the code stops working when the time is up.';
      box.appendChild(hint);
      var form = document.createElement('form');
      var labLabel = document.createElement('label');
      labLabel.appendChild(document.createTextNode('Session name'));
      var labInput = document.createElement('input');
      labInput.type = 'text';
      labInput.placeholder = 'e.g. Week 6 — blank for today’s date';
      labInput.size = 32;
      labLabel.appendChild(labInput);
      form.appendChild(labLabel);
      var minLabel = document.createElement('label');
      minLabel.appendChild(document.createTextNode('Open for (minutes)'));
      var minInput = document.createElement('input');
      minInput.type = 'number';
      minInput.min = '1';
      minInput.max = '600';
      minInput.value = data.windowMinutes || 10;
      minLabel.appendChild(minInput);
      form.appendChild(minLabel);
      var start = document.createElement('button');
      start.type = 'submit';
      start.className = 'button primary';
      start.textContent = 'Start check-in';
      form.appendChild(start);
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        start.disabled = true;
        attendanceCall({ action: 'adminStartSession', label: labInput.value.trim(), minutes: parseInt(minInput.value, 10) }, 'Check-in started. Click "Show on screen" to project the code.')
          .then(function () {
            var opened = attendance.data && openSessionOf(attendance.data);
            if (opened) window.open(displayUrl(opened), '_blank', 'noopener');
          });
      });
      box.appendChild(form);

      var last = data.sessions.filter(function (s) { return !s.open && s.closes; })[0];
      if (last) {
        var reopen = document.createElement('p');
        reopen.className = 'hint';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'link-button';
        btn.textContent = 'Reopen "' + last.label + '" for 5 more minutes';
        btn.addEventListener('click', function () {
          attendanceCall({ action: 'adminExtendSession', sessionId: last.id, minutes: 5 }, 'Reopened for 5 minutes.');
        });
        reopen.appendChild(btn);
        box.appendChild(reopen);
      }
    }

    function stat(label, value) {
      var wrap = document.createElement('div');
      wrap.className = 'stat';
      var strong = document.createElement('strong');
      strong.textContent = value;
      var span = document.createElement('span');
      span.textContent = label;
      wrap.appendChild(strong);
      wrap.appendChild(span);
      return wrap;
    }

    function renderCountdown() {
      var el = $('#admin-countdown');
      var open = attendance.data && openSessionOf(attendance.data);
      if (!el || !open) return;
      var left = Math.floor((new Date(open.closes).getTime() - Date.now()) / 1000);
      if (left <= 0) {
        el.textContent = '0:00';
        if (attendance.ticks % 5 === 0) attendanceLoad(); // show it as closed
        return;
      }
      el.textContent = Math.floor(left / 60) + ':' + pad(left % 60);
      el.className = 'countdown';
    }

    function displayUrl(session) {
      var p = new URLSearchParams();
      p.set('u', pageUrl('attend.html', { k: session.code }));
      p.set('s', pageUrl('attend.html'));
      p.set('k', session.code);
      p.set('l', session.label);
      p.set('t', state.course ? [state.course.code, state.course.name].filter(Boolean).join(' ') : '');
      p.set('e', session.closes);
      return location.origin + location.pathname.replace(/[^/]*$/, '') + 'display.html#' + p.toString();
    }

    function renderSessionSelect() {
      var sel = $('#admin-session-select');
      sel.textContent = '';
      var sessions = attendance.data.sessions;
      if (!sessions.length) {
        var opt = document.createElement('option');
        opt.textContent = 'No sessions yet';
        sel.appendChild(opt);
        sel.disabled = true;
        return;
      }
      sel.disabled = false;
      sessions.forEach(function (s) {
        var o = document.createElement('option');
        o.value = s.id;
        o.textContent = s.label + ' — ' + formatDate(s.opened) + (s.open ? ' (open)' : '');
        if (s.id === attendance.sessionId) o.selected = true;
        sel.appendChild(o);
      });
    }

    function renderAttendanceTable() {
      var data = attendance.data;
      var tbody = $('#admin-attendance-table tbody');
      tbody.textContent = '';
      var session = data.sessions.filter(function (s) { return s.id === attendance.sessionId; })[0];
      if (!session) {
        $('#admin-attendance-summary').textContent = 'Start a check-in to take attendance. Each session becomes a column in the CSV.';
        return;
      }
      var byEmail = {};
      data.records.forEach(function (r) { if (r.sessionId === session.id) byEmail[r.email] = r; });
      var roster = data.roster.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
      roster.forEach(function (r) {
        var rec = byEmail[r.email];
        var tr = document.createElement('tr');
        var name = document.createElement('td'); name.textContent = r.name; tr.appendChild(name);
        var email = document.createElement('td'); email.textContent = r.email; tr.appendChild(email);
        var status = document.createElement('td');
        status.className = rec ? 'present' : 'absent';
        status.textContent = rec ? 'Present ' + formatTime(rec.time) + (rec.by === 'instructor' ? ' (marked by you)' : '') : 'Absent';
        tr.appendChild(status);
        var flag = document.createElement('td');
        flag.className = 'flag';
        flag.textContent = rec && rec.flag ? rec.flag : '';
        tr.appendChild(flag);
        var act = document.createElement('td');
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'link-button';
        btn.textContent = rec ? 'Mark absent' : 'Mark present';
        btn.addEventListener('click', function () {
          attendanceCall({ action: 'adminMarkAttendance', sessionId: session.id, email: r.email, present: !rec },
            (rec ? 'Removed ' : 'Marked ') + r.name + (rec ? '’s check-in.' : ' present.'));
        });
        act.appendChild(btn);
        tr.appendChild(act);
        tbody.appendChild(tr);
      });
      var unknown = data.records.filter(function (r) { return r.sessionId === session.id && !data.roster.some(function (x) { return x.email === r.email; }); });
      $('#admin-attendance-summary').textContent = session.label + ': ' + session.present + ' of ' + roster.length + ' present' +
        (session.flagged ? ', ' + session.flagged + ' flagged (two students checked in from the same phone)' : '') +
        (unknown.length ? ', ' + unknown.length + ' check-in(s) from students no longer on the roster' : '') + '.';
    }

    /** One row per student, one column per session (oldest first), 1 = present, then a total. */
    function attendanceCsv(data) {
      var sessions = data.sessions.slice().reverse();
      var header = ['email', 'name'].concat(sessions.map(function (s) { return s.label + ' (' + formatDate(s.opened, true) + ')'; })).concat(['present_count', 'session_count']);
      var present = {};
      data.records.forEach(function (r) { present[r.sessionId + '|' + r.email] = true; });
      var roster = data.roster.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
      var rows = roster.map(function (r) {
        var cells = sessions.map(function (s) { return present[s.id + '|' + r.email] ? 1 : 0; });
        var total = cells.reduce(function (a, b) { return a + b; }, 0);
        return [r.email, r.name].concat(cells).concat([total, sessions.length]);
      });
      return toCsv([header].concat(rows));
    }

    function adminNotify(message, kind) {
      var n = $('#admin-notice');
      n.textContent = message;
      n.className = 'notice ' + (kind || '');
      n.hidden = !message;
    }

    function adminLoad() {
      Promise.all([
        api({ action: 'export', adminKey: admin.key }),
        api({ action: 'adminGet', adminKey: admin.key })
      ])
        .then(function (results) {
          admin.data = results[0];
          admin.config = results[1];
          storageSet(sessionStorage, adminKeyKey(), admin.key);
          login.hidden = true;
          body.hidden = false;
          adminNotify('');
          renderAdmin();
        })
        .catch(function (err) {
          showLogin();
          notify(err.message, 'error');
        });
    }

    function adminSave(payload, successMessage) {
      payload.adminKey = admin.key;
      adminNotify('Saving…');
      api(payload)
        .then(function (data) {
          admin.config = data;
          renderAdmin();
          adminNotify(successMessage, 'success');
          load();
        })
        .catch(function (err) { adminNotify(err.message, 'error'); });
    }

    function renderAdmin() {
      renderSignups(admin.data);
      renderCourseForm(admin.config);
      admin.assignments = JSON.parse(JSON.stringify(admin.config.assignments));
      renderAssignmentsEditor();
      renderRoster(admin.config);
    }

    function renderSignups(data) {
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

    var COURSE_FIELDS = [
      ['COURSE_NAME', 'Course name'], ['COURSE_CODE', 'Course code'], ['YEAR', 'Year'],
      ['TERM', 'Term'], ['SECTION', 'Section'], ['PROFESSOR', 'Professor']
    ];
    var SETTING_FIELDS = [
      ['SIGNUP_OPEN', 'Signup open for all assignments', 'checkbox'],
      ['SELF_SERVICE_LINKS', 'Students can find their name and get their link by email', 'checkbox'],
      ['OPEN_ENROLLMENT', 'Open enrollment (anyone can register with an email)', 'checkbox'],
      ['NAME_DISPLAY', 'How members are shown to classmates', 'select', [['initial', 'First name and last initial'], ['full', 'Full name']]],
      ['SITE_URL', 'Site URL, including ?c=<course key>', 'url'],
      ['ATTENDANCE_WINDOW_MINUTES', 'Attendance check-in stays open for (minutes)', 'number']
    ];
    var EMAIL_FIELDS = [
      ['EMAIL_SENDER_NAME', 'Sender name (From line)', 'text'],
      ['EMAIL_REPLY_TO', 'Reply-to address', 'email'],
      ['EMAIL_SUBJECT', 'Subject', 'text'],
      ['EMAIL_SIGNATURE', 'Signature (line breaks kept)', 'textarea']
    ];

    function field(key, label, type, value, options) {
      var lab = document.createElement('label');
      if (type === 'checkbox') lab.className = 'checkbox';
      if (type === 'textarea') lab.className = 'wide';
      var control;
      if (type === 'select') {
        control = document.createElement('select');
        options.forEach(function (o) {
          var opt = document.createElement('option');
          opt.value = o[0]; opt.textContent = o[1];
          if (o[0] === value) opt.selected = true;
          control.appendChild(opt);
        });
      } else if (type === 'textarea') {
        control = document.createElement('textarea');
        control.rows = 4;
        control.value = value || '';
      } else {
        control = document.createElement('input');
        control.type = type || 'text';
        if (type === 'checkbox') control.checked = /^(true|yes|1|on)$/i.test(String(value || ''));
        else control.value = value || '';
      }
      control.name = key;
      if (type === 'checkbox') { lab.appendChild(control); lab.appendChild(document.createTextNode(label)); }
      else { lab.appendChild(document.createTextNode(label)); lab.appendChild(control); }
      return lab;
    }

    function heading(text) { var h = document.createElement('h3'); h.textContent = text; return h; }

    function renderCourseForm(config) {
      var form = $('#admin-course-form');
      form.textContent = '';
      form.appendChild(heading('Course'));
      COURSE_FIELDS.forEach(function (f) { form.appendChild(field(f[0], f[1], 'text', config.course[f[0]])); });
      form.appendChild(heading('Signup settings'));
      SETTING_FIELDS.forEach(function (f) { form.appendChild(field(f[0], f[1], f[2], config.settings[f[0]], f[3])); });
      form.appendChild(heading('Link email'));
      EMAIL_FIELDS.forEach(function (f) { form.appendChild(field(f[0], f[1], f[2], config.settings[f[0]])); });
      var actions = document.createElement('div');
      actions.className = 'actions';
      var save = document.createElement('button');
      save.type = 'submit';
      save.className = 'button primary';
      save.textContent = 'Save course & settings';
      actions.appendChild(save);
      var note = document.createElement('span');
      note.className = 'hint';
      note.textContent = ' The admin key can only be changed in the Settings sheet.';
      actions.appendChild(note);
      form.appendChild(actions);
      form.onsubmit = function (ev) {
        ev.preventDefault();
        var course = {}, settings = {};
        COURSE_FIELDS.forEach(function (f) { course[f[0]] = form.elements[f[0]].value.trim(); });
        SETTING_FIELDS.concat(EMAIL_FIELDS).forEach(function (f) {
          var el = form.elements[f[0]];
          settings[f[0]] = f[2] === 'checkbox' ? (el.checked ? 'true' : 'false') : el.value.trim();
        });
        adminSave({ action: 'adminSaveCourse', course: course, settings: settings }, 'Course and settings saved.');
      };
    }

    function renderAssignmentsEditor() {
      var container = $('#admin-assignments');
      container.textContent = '';
      if (!admin.assignments.length) {
        var none = document.createElement('p');
        none.className = 'hint';
        none.textContent = 'No assignments yet. Click "Add assignment".';
        container.appendChild(none);
      }
      admin.assignments.forEach(function (a, index) {
        var det = document.createElement('details');
        det.className = 'assignment-editor';
        det.open = !!a.isNew;
        var sum = document.createElement('summary');
        sum.textContent = (a.name || a.id || 'New assignment') + (a.id ? ' (' + a.id + ')' : '') + ' — ' + a.groups.length + ' group' + (a.groups.length === 1 ? '' : 's');
        det.appendChild(sum);

        var fields = document.createElement('div');
        fields.className = 'fields';
        fields.appendChild(bound(a, 'id', 'Id (short, letters/digits/-/_)', 'text', !a.isNew));
        fields.appendChild(bound(a, 'name', 'Name', 'text'));
        fields.appendChild(bound(a, 'due', 'Due date', 'date'));
        fields.appendChild(bound(a, 'signupCloses', 'Signup closes', 'datetime-local'));
        var openLab = document.createElement('label');
        openLab.className = 'checkbox';
        var openBox = document.createElement('input');
        openBox.type = 'checkbox';
        openBox.checked = a.open !== false && !/^(false|no|0|off)$/i.test(String(a.open));
        openBox.addEventListener('change', function () { a.open = openBox.checked; });
        openLab.appendChild(openBox);
        openLab.appendChild(document.createTextNode('Signup open for this assignment'));
        fields.appendChild(openLab);
        var instr = bound(a, 'instructions', 'Instructions (shown above the groups)', 'textarea');
        instr.className = 'wide';
        fields.appendChild(instr);
        det.appendChild(fields);

        var table = document.createElement('table');
        table.innerHTML = '<thead><tr><th>Group id</th><th>Name</th><th>Slots (blank = no limit)</th><th>Description</th><th></th></tr></thead>';
        var tbody = document.createElement('tbody');
        a.groups.forEach(function (g, gi) {
          var tr = document.createElement('tr');
          ['id', 'name', 'slots', 'description'].forEach(function (k) {
            var td = document.createElement('td');
            var input = document.createElement('input');
            input.type = k === 'slots' ? 'number' : 'text';
            if (k === 'slots') input.min = '0';
            input.value = g[k] == null ? '' : (k === 'slots' && !g[k] ? '' : g[k]);
            input.setAttribute('aria-label', k);
            input.addEventListener('input', function () { g[k] = input.value; });
            td.appendChild(input);
            tr.appendChild(td);
          });
          var tdRemove = document.createElement('td');
          var rm = document.createElement('button');
          rm.type = 'button';
          rm.className = 'link-button';
          rm.textContent = 'Remove';
          rm.addEventListener('click', function () { a.groups.splice(gi, 1); renderAssignmentsEditor(); reopen(index); });
          tdRemove.appendChild(rm);
          tr.appendChild(tdRemove);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        det.appendChild(table);

        var gactions = document.createElement('div');
        gactions.className = 'groups-actions';
        var addGroup = document.createElement('button');
        addGroup.type = 'button';
        addGroup.className = 'button';
        addGroup.textContent = 'Add group';
        addGroup.addEventListener('click', function () {
          a.groups.push({ id: '', name: '', slots: '', description: '' });
          renderAssignmentsEditor();
          reopen(index);
        });
        var addMany = document.createElement('button');
        addMany.type = 'button';
        addMany.className = 'button';
        addMany.textContent = 'Add several…';
        addMany.addEventListener('click', function () {
          var text = window.prompt('One group per line. Optionally add a comma and the number of slots, e.g.\nAustralia, 4\nDenmark, 4');
          if (!text) return;
          text.split(/\r?\n/).forEach(function (line) {
            var parts = line.split(',');
            var name = parts[0].trim();
            if (!name) return;
            a.groups.push({ id: name, name: name, slots: (parts[1] || '').trim(), description: (parts.slice(2).join(',') || '').trim() });
          });
          renderAssignmentsEditor();
          reopen(index);
        });
        var removeAssignment = document.createElement('button');
        removeAssignment.type = 'button';
        removeAssignment.className = 'button danger';
        removeAssignment.textContent = 'Remove assignment';
        removeAssignment.addEventListener('click', function () {
          if (!window.confirm('Remove "' + (a.name || a.id) + '" from the list? Its tab stays in the Sheet until you delete it there.')) return;
          admin.assignments.splice(index, 1);
          renderAssignmentsEditor();
        });
        gactions.appendChild(addGroup);
        gactions.appendChild(addMany);
        gactions.appendChild(removeAssignment);
        det.appendChild(gactions);
        container.appendChild(det);
      });

      function reopen(i) {
        var editors = document.querySelectorAll('.assignment-editor');
        if (editors[i]) editors[i].open = true;
      }
    }

    function bound(obj, key, label, type, readOnly) {
      var lab = document.createElement('label');
      lab.appendChild(document.createTextNode(label));
      var control = document.createElement(type === 'textarea' ? 'textarea' : 'input');
      if (type === 'textarea') control.rows = 3; else control.type = type;
      var value = obj[key] == null ? '' : String(obj[key]);
      if (type === 'date') value = toDateInput(value);
      if (type === 'datetime-local') value = toDateTimeInput(value);
      control.value = value;
      if (readOnly) { control.readOnly = true; control.title = 'Ids cannot be changed once created.'; }
      control.addEventListener('input', function () { obj[key] = control.value; });
      lab.appendChild(control);
      return lab;
    }

    function renderRoster(config) {
      var text = config.roster.map(function (r) { return r.email + ', ' + r.name; }).join('\n');
      $('#admin-roster').value = text;
      $('#admin-roster-remove').checked = false;
      $('#admin-roster-count').textContent = config.roster.length + ' on roster';
    }

    function parseRosterText(text) {
      var out = [];
      String(text || '').split(/\r?\n/).forEach(function (line) {
        line = line.trim();
        if (!line) return;
        var parts = line.split(/\t|,/);
        var email = (parts.shift() || '').trim();
        var name = parts.join(' ').replace(/\s+/g, ' ').trim();
        if (/@/.test(name) && !/@/.test(email)) { var t = email; email = name; name = t; }
        if (email) out.push({ email: email, name: name });
      });
      return out;
    }

    function downloadCsv(csv, suffix) {
      var code = (state.course && state.course.code) || 'course';
      var kind = suffix === 'attendance' ? '' : '_signups';
      var name = (code + '_' + suffix + kind + '_' + new Date().toISOString().slice(0, 10)).replace(/[^\w\-]+/g, '_') + '.csv';
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function toDateInput(value) {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    var d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function toDateTimeInput(value) {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
    var d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return toDateInput(value) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
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
  // Demo backend (used when no course is configured, or with ?demo=1).
  // The sample data lives in this browser's localStorage so the signup page,
  // the check-in page and the instructor panel all see the same thing.
  // -------------------------------------------------------------------------
  function demoApi(payload) {
    if (!demoApi.db) {
      try { demoApi.db = JSON.parse(storageGet(localStorage, 'groupSignup.demoDb')) || null; } catch (e) { demoApi.db = null; }
    }
    return demoApiInner(payload).then(
      function (res) { storageSet(localStorage, 'groupSignup.demoDb', JSON.stringify(demoApi.db)); return res; },
      function (err) { storageSet(localStorage, 'groupSignup.demoDb', JSON.stringify(demoApi.db)); throw err; }
    );
  }

  function demoApiInner(payload) {
    var db = demoApi.db || (demoApi.db = {
      course: { name: 'Canadian Politics', code: 'POL 2230', year: '2026', term: 'Fall', section: '001', professor: 'Prof. Example' },
      settings: { signupOpen: true, openEnrollment: false, selfServiceLinks: true },
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
                 'katherine@example.com|presentations': 'w7', 'ada@example.com|debates': 'pro' },
      sessions: [
        { id: '2026-10-11-1003', label: 'Week 5', code: '4821', opened: '2026-10-11T14:03:00Z', closes: '2026-10-11T14:13:00Z', closedAt: '2026-10-11T14:13:00Z' }
      ],
      attendance: [
        { sessionId: '2026-10-11-1003', email: 'ada@example.com', time: '2026-10-11T14:04:10Z', device: 'demo-dev-1', by: 'student' },
        { sessionId: '2026-10-11-1003', email: 'grace@example.com', time: '2026-10-11T14:05:30Z', device: 'demo-dev-2', by: 'student' }
      ],
      wrongCodes: {}
    });

    function who(t) { return db.roster.filter(function (r) { return r.token === t; })[0] || null; }
    function sessionOpen(s) { return !s.closedAt && new Date() < new Date(s.closes); }
    function openSess() { var o = db.sessions.filter(sessionOpen); return o[o.length - 1] || null; }
    function rec(sid, email) { return db.attendance.filter(function (x) { return x.sessionId === sid && x.email === email; })[0] || null; }
    function attendState(r) {
      var open = openSess();
      var mine = r && open ? rec(open.id, r.email) : null;
      return {
        me: r ? { email: r.email, name: r.name } : null,
        session: open ? { id: open.id, label: open.label, opened: open.opened, closes: open.closes } : null,
        checkedIn: mine ? { label: open.label, time: mine.time } : null,
        history: r ? db.sessions.filter(function (s) { return !sessionOpen(s); })
          .map(function (s) { return { label: s.label, date: s.opened, present: !!rec(s.id, r.email) }; }) : []
      };
    }
    function adminAttendance(extra) {
      var nameOf = {};
      db.roster.forEach(function (x) { nameOf[x.email] = x.name; });
      var byDev = {};
      db.attendance.forEach(function (x) { if (x.device) (byDev[x.sessionId + '|' + x.device] = byDev[x.sessionId + '|' + x.device] || []).push(x.email); });
      var records = db.attendance.map(function (x) {
        var others = x.device ? byDev[x.sessionId + '|' + x.device].filter(function (e) { return e !== x.email; }) : [];
        return { sessionId: x.sessionId, email: x.email, name: nameOf[x.email] || '', time: x.time, by: x.by,
          flag: others.length ? 'Same phone as ' + others.map(function (e) { return nameOf[e] || e; }).join(', ') : '' };
      });
      var sessions = db.sessions.map(function (s) {
        var mine = records.filter(function (x) { return x.sessionId === s.id; });
        return { id: s.id, label: s.label, code: s.code, open: sessionOpen(s), opened: s.opened, closes: s.closes, closedAt: s.closedAt,
          present: mine.length, flagged: mine.filter(function (x) { return x.flag; }).length };
      }).reverse();
      return Object.assign({ sessions: sessions, records: records, roster: db.roster.map(function (x) { return { email: x.email, name: x.name }; }),
        windowMinutes: parseInt((db.rawSettings || {}).ATTENDANCE_WINDOW_MINUTES, 10) || 10 }, extra || {});
    }
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

    function mask(e) { return e.charAt(0) + '***' + e.slice(e.indexOf('@')); }
    var r = who(payload.token);
    var a = db.assignments.filter(function (x) { return x.id === payload.assignmentId; })[0];
    switch (payload.action) {
      case 'state':
        return ok({ me: r ? me(r) : null });
      case 'roster':
        return ok({ roster: db.roster.map(function (x) { return { id: 'id-' + x.email, name: x.name }; })
          .sort(function (p, q) { return p.name.localeCompare(q.name); }) });
      case 'sendLink': {
        var entry = db.roster.filter(function (x) { return 'id-' + x.email === payload.rosterId; })[0];
        if (!entry) return fail('That name is not on the roster.');
        return ok({ sentTo: mask(entry.email) + ' (demo: no email is really sent; use ?t=' + entry.token + ')' });
      }
      case 'resetToken':
        if (!r) return fail('Your link is not recognised (demo).');
        r.token = 'demo-' + Math.random().toString(36).slice(2, 8);
        return ok({ sentTo: mask(r.email) + ' (demo: new token ' + r.token + ')' });
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
      case 'attendState':
        return ok(attendState(r));
      case 'attend': {
        if (!r) return fail('Your link is not recognised (demo).');
        var live = openSess();
        if (!live) return fail('No attendance session is open right now. Wait for the instructor to start one, then try again.');
        if (rec(live.id, r.email)) return ok(attendState(r));
        var wk = live.id + '|' + r.email;
        if ((db.wrongCodes[wk] || 0) >= 5) return fail('Too many wrong codes. Please see the instructor to be marked present.');
        if (String(payload.code || '').replace(/\D/g, '') !== live.code) {
          db.wrongCodes[wk] = (db.wrongCodes[wk] || 0) + 1;
          var left = 5 - db.wrongCodes[wk];
          return fail(left > 0 ? 'That code is not right. Check the slide and try again (' + left + ' ' + (left === 1 ? 'try' : 'tries') + ' left).'
            : 'That code is not right, and you have run out of tries. Please see the instructor.');
        }
        db.attendance.push({ sessionId: live.id, email: r.email, time: new Date().toISOString(), device: String(payload.device || '').slice(0, 12), by: 'student' });
        return ok(attendState(r));
      }
      case 'adminAttendance':
      case 'adminStartSession':
      case 'adminCloseSession':
      case 'adminExtendSession':
      case 'adminMarkAttendance': {
        if (payload.adminKey !== 'demo') return fail('Wrong admin key. (In demo mode the key is "demo".)');
        var now = new Date();
        var extra = {};
        var target = db.sessions.filter(function (s) { return s.id === payload.sessionId; })[0];
        if (payload.action === 'adminStartSession') {
          db.sessions.forEach(function (s) { if (sessionOpen(s)) s.closedAt = now.toISOString(); });
          var minutes = Math.min(600, Math.max(1, parseInt(payload.minutes, 10) || 10));
          var sid = now.toISOString().slice(0, 16).replace(/[T:]/g, '-');
          db.sessions.push({ id: sid, label: String(payload.label || '').trim() || now.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
            code: String(1000 + Math.floor(Math.random() * 9000)), opened: now.toISOString(), closes: new Date(now.getTime() + minutes * 60000).toISOString(), closedAt: '' });
          extra.started = sid;
        } else if (payload.action !== 'adminAttendance' && !target) {
          return fail('That session does not exist.');
        } else if (payload.action === 'adminCloseSession') {
          if (!target.closedAt) target.closedAt = now.toISOString();
        } else if (payload.action === 'adminExtendSession') {
          var from = sessionOpen(target) ? new Date(target.closes) : now;
          target.closes = new Date(from.getTime() + (parseInt(payload.minutes, 10) || 10) * 60000).toISOString();
          target.closedAt = '';
        } else if (payload.action === 'adminMarkAttendance') {
          var em = String(payload.email || '').trim().toLowerCase();
          if (!db.roster.some(function (x) { return x.email === em; })) return fail('That student is not on the roster.');
          if (payload.present) { if (!rec(target.id, em)) db.attendance.push({ sessionId: target.id, email: em, time: now.toISOString(), device: '', by: 'instructor' }); }
          else db.attendance = db.attendance.filter(function (x) { return !(x.sessionId === target.id && x.email === em); });
        }
        return ok(adminAttendance(extra));
      }
      case 'adminGet':
      case 'adminSaveCourse':
      case 'adminSaveAssignments':
      case 'adminSaveRoster': {
        if (payload.adminKey !== 'demo') return fail('Wrong admin key. (In demo mode the key is "demo".)');
        if (payload.action === 'adminSaveCourse') {
          var c = payload.course || {}, st = payload.settings || {};
          if (c.COURSE_NAME) db.course.name = c.COURSE_NAME;
          if (c.COURSE_CODE) db.course.code = c.COURSE_CODE;
          if (c.YEAR) db.course.year = c.YEAR;
          if (c.TERM) db.course.term = c.TERM;
          if (c.SECTION) db.course.section = c.SECTION;
          if (c.PROFESSOR) db.course.professor = c.PROFESSOR;
          if ('SIGNUP_OPEN' in st) db.settings.signupOpen = st.SIGNUP_OPEN === 'true';
          if ('OPEN_ENROLLMENT' in st) db.settings.openEnrollment = st.OPEN_ENROLLMENT === 'true';
          if ('SELF_SERVICE_LINKS' in st) db.settings.selfServiceLinks = st.SELF_SERVICE_LINKS === 'true';
          db.rawSettings = Object.assign(db.rawSettings || {}, st);
        }
        if (payload.action === 'adminSaveAssignments') {
          db.assignments = (payload.assignments || []).map(function (x) {
            return { id: x.id, name: x.name || x.id, due: x.due || '', signupCloses: x.signupCloses || '', open: x.open !== false && x.open !== 'false',
              instructions: x.instructions || '', groups: (x.groups || []).map(function (g) {
                return { id: g.id, name: g.name || g.id, slots: parseInt(g.slots, 10) || 0, description: g.description || '' };
              }) };
          });
        }
        if (payload.action === 'adminSaveRoster') {
          var keep = {};
          (payload.roster || []).forEach(function (x) {
            var em = String(x.email || '').trim().toLowerCase();
            if (!em) return;
            keep[em] = true;
            var ex = db.roster.filter(function (y) { return y.email === em; })[0];
            if (ex) { if (x.name) ex.name = x.name; }
            else db.roster.push({ email: em, name: x.name || em, token: '' });
          });
          if (payload.removeMissing) db.roster = db.roster.filter(function (y) { return keep[y.email]; });
        }
        var raw = Object.assign({ SIGNUP_OPEN: String(db.settings.signupOpen), OPEN_ENROLLMENT: String(db.settings.openEnrollment),
          SELF_SERVICE_LINKS: String(db.settings.selfServiceLinks), NAME_DISPLAY: 'initial', SITE_URL: location.origin + location.pathname,
          EMAIL_SENDER_NAME: '', EMAIL_REPLY_TO: '', EMAIL_SUBJECT: '', EMAIL_SIGNATURE: '', ATTENDANCE_WINDOW_MINUTES: '10' }, db.rawSettings || {});
        return ok({
          course: { COURSE_NAME: db.course.name, COURSE_CODE: db.course.code, YEAR: db.course.year, TERM: db.course.term, SECTION: db.course.section, PROFESSOR: db.course.professor },
          settings: raw,
          assignments: db.assignments.map(function (x) { return { id: x.id, name: x.name, due: x.due, signupCloses: x.signupCloses, open: x.open, instructions: x.instructions, groups: x.groups }; }),
          roster: db.roster.map(function (x) { return { email: x.email, name: x.name, hasToken: !!x.token }; })
        });
      }
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
