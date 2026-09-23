const state = {
  projects: [],
  currentProject: null,
  activeFilter: 'all',
  currentView: 'grid',
  authMode: 'signin',
  editing: false,
  user: null,
  commandOpen: false,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const refs = {
  authGate: $('#authGate'),
  appShell: $('#appShell'),
  authForm: $('#authForm'),
  authNameField: $('.auth-name-field'),
  authSubmit: $('#authSubmit'),
  authError: $('#authError'),
  googleButton: $('#googleButton'),
  projectGrid: $('#projectGrid'),
  searchInput: $('#searchInput'),
  projectCount: $('#projectCount'),
  resultsLabel: $('#resultsLabel'),
  filterButton: $('#filterButton'),
  filterButtonLabel: $('#filterButtonLabel'),
  filterMenu: $('#filterMenu'),
  activeFilterLabel: $('#activeFilterLabel'),
  modalBackdrop: $('#modalBackdrop'),
  projectForm: $('#projectForm'),
  modalTitle: $('#modalTitle'),
  modalEyebrow: $('#modalEyebrow'),
  saveProjectButton: $('#saveProjectButton'),
  formError: $('#formError'),
  detailView: $('#detailView'),
  projectsView: $('#projectsView'),
  domainsView: $('#domainsView'),
  attentionView: $('#attentionView'),
  detailHeader: $('#detailHeader'),
  detailGrid: $('#detailGrid'),
  domainsTable: $('#domainsTable'),
  attentionGrid: $('#attentionGrid'),
  profileMenu: $('#profileMenu'),
  avatarButton: $('#avatarButton'),
  profileName: $('#profileName'),
  profileEmail: $('#profileEmail'),
  toast: $('#toast'),
  commandBackdrop: $('#commandBackdrop'),
  commandInput: $('#commandInput'),
  commandList: $('#commandList'),
};

const seedPreview = [
  {
    id: 'local-1', name: 'DevSalary', slug: 'devsalary', description: 'Developer salary intelligence platform.', status: 'active', priority: 'high', category: 'SaaS',
    technologies: [{ name: 'Go', kind: 'language' }, { name: 'PostgreSQL', kind: 'database' }, { name: 'React', kind: 'framework' }],
    domains: [{ hostname: 'devsalary.app', registrar: 'Namecheap', dnsProvider: 'Cloudflare', autoRenew: true, expiresAt: '2027-04-18' }],
    deployments: [{ name: 'Production', provider: 'Vercel', environment: 'production', url: 'https://devsalary.app', status: 'active' }],
    databases: [{ name: 'Primary', provider: 'Neon', databaseType: 'PostgreSQL', environment: 'production' }],
    links: [{ label: 'GitHub', url: 'https://github.com/', kind: 'github' }], notes: 'Local preview record. Connect Neon to persist real projects.',
    activities: [{ action: 'created', detail: 'Project created.', createdAt: new Date().toISOString() }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
  {
    id: 'local-2', name: 'Stackroom', slug: 'stackroom', description: 'A private archive for every project and technical detail.', status: 'active', priority: 'normal', category: 'Tool',
    technologies: [{ name: 'Go', kind: 'language' }, { name: 'Neon', kind: 'infrastructure' }], domains: [], deployments: [], databases: [], links: [], notes: 'The project organizer itself.',
    activities: [{ action: 'created', detail: 'Project created.', createdAt: new Date().toISOString() }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
];

function escapeHTML(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' })[character]);
}

function normalizeURL(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function statusName(status) {
  return { active: 'Active', shipped: 'Shipped', idea: 'Idea', archived: 'Archived' }[status] || 'Active';
}

function statusTone(status) {
  return statusName(status).toLowerCase();
}

function relativeDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function relativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return relativeDate(value);
}

function initials(name = 'S') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'S';
}

function showToast(message) {
  refs.toast.textContent = message;
  refs.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { refs.toast.hidden = true; }, 2800);
}

function showAuthError(message) {
  refs.authError.textContent = message;
  refs.authError.hidden = false;
}

function apiError(payload, fallback = 'Something went wrong') {
  return payload?.error || payload?.message || fallback;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json().catch(() => ({})) : null;
  if (!response.ok) throw new Error(apiError(payload, `Request failed (${response.status})`));
  return payload;
}

function setPage(page) {
  refs.projectsView.hidden = page !== 'projects';
  refs.detailView.hidden = page !== 'detail';
  refs.domainsView.hidden = page !== 'domains';
  refs.attentionView.hidden = page !== 'attention';
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.nav === page));
  const current = { projects: 'All projects', detail: state.currentProject?.name || 'Project', domains: 'Domains', attention: 'Attention' }[page] || 'All projects';
  $('#breadcrumbCurrent').textContent = current;
  if (page === 'domains') renderDomainsPage();
  if (page === 'attention') renderAttentionPage();
}

function setAuthMode(mode) {
  state.authMode = mode;
  const signup = mode === 'signup';
  refs.authNameField.hidden = !signup;
  $('input', refs.authNameField).required = signup;
  refs.authSubmit.innerHTML = signup ? 'Create account <span>→</span>' : 'Sign in <span>→</span>';
  $$('.auth-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.authMode === mode));
  refs.authError.hidden = true;
}

async function loadSession() {
  try {
    const payload = await api('/api/auth/get-session');
    if (payload?.user && payload?.session) {
      state.user = payload.user;
      enterApp();
      await loadProjects();
      return;
    }
  } catch (error) {
    console.error(error);
  }
  refs.authGate.hidden = false;
  refs.appShell.hidden = true;
}

function enterApp() {
  refs.authGate.hidden = true;
  refs.appShell.hidden = false;
  const user = state.user || {};
  refs.avatarButton.textContent = initials(user.name || user.email || 'S');
  refs.profileName.textContent = user.name || 'Signed in';
  refs.profileEmail.textContent = user.email || '—';
}

async function submitAuth(event) {
  event.preventDefault();
  refs.authError.hidden = true;
  const formData = new FormData(refs.authForm);
  const path = state.authMode === 'signup' ? 'sign-up/email' : 'sign-in/email';
  const body = { email: String(formData.get('email') || ''), password: String(formData.get('password') || '') };
  if (state.authMode === 'signup') body.name = String(formData.get('name') || '');
  refs.authSubmit.disabled = true;
  try {
    const payload = await api(`/api/auth/${path}`, { method: 'POST', body: JSON.stringify(body) });
    state.user = payload?.user || null;
    await loadSession();
  } catch (error) {
    showAuthError(error.message);
  } finally {
    refs.authSubmit.disabled = false;
  }
}

async function continueWithGoogle() {
  refs.authError.hidden = true;
  refs.googleButton.disabled = true;

  try {
    const payload = await api('/api/auth/sign-in/social', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'google',
        callbackURL: window.location.origin + '/',
        requestSignUp: state.authMode === 'signup'
      })
    });

    const redirectURL = payload?.url || payload?.data?.url;

    if (!redirectURL) {
      throw new Error('Google authentication is not available.');
    }

    window.location.assign(redirectURL);
  } catch (error) {
    showAuthError(error.message);
  } finally {
    refs.googleButton.disabled = false;
  }
}
async function loadProjects() {
  try {
    const payload = await api('/api/projects');
    state.projects = Array.isArray(payload) ? payload : [];
  } catch (error) {
    state.projects = seedPreview;
    showToast(`Preview mode: ${error.message}`);
  }
  renderDashboard();
}

function projectSearchText(project) {
  return [
    project.name, project.description, project.category, project.status, project.priority,
    ...(project.technologies || []).map(item => `${item.name} ${item.kind}`),
    ...(project.domains || []).flatMap(item => [item.hostname, item.registrar, item.dnsProvider]),
    ...(project.deployments || []).flatMap(item => [item.name, item.provider, item.environment, item.url, item.repository]),
    ...(project.databases || []).flatMap(item => [item.name, item.provider, item.databaseType, item.environment]),
    ...(project.links || []).flatMap(item => [item.label, item.url, item.kind]),
    project.notes,
  ].join(' ').toLowerCase();
}

function visibleProjects() {
  const query = refs.searchInput.value.trim().toLowerCase();
  return state.projects.filter(project => {
    const matchesFilter = state.activeFilter === 'all' || project.status === state.activeFilter;
    return matchesFilter && (!query || projectSearchText(project).includes(query));
  });
}

function projectHealth(project) {
  const checks = [
    Boolean(project.description?.trim()),
    Boolean(project.category?.trim()),
    Boolean(project.technologies?.length),
    Boolean(project.domains?.length),
    Boolean(project.deployments?.length),
    Boolean(project.databases?.length),
    Boolean(project.links?.length),
    Boolean(project.notes?.trim()),
  ];
  const score = Math.round((checks.filter(Boolean).length / checks.length) * 100);
  return { score, checks };
}

function healthLabel(score) {
  if (score >= 88) return 'Complete';
  if (score >= 63) return 'Healthy';
  if (score >= 38) return 'Needs details';
  return 'Sparse';
}

function daysUntil(dateString) {
  if (!dateString) return null;
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

function expiringDomains(windowDays = 45) {
  return state.projects.flatMap(project => (project.domains || []).map(domain => ({ project, domain, days: daysUntil(domain.expiresAt) }))).filter(item => item.days !== null && item.days <= windowDays).sort((a, b) => a.days - b.days);
}

function staleProjects(windowDays = 60) {
  const threshold = Date.now() - windowDays * 86400000;
  return state.projects.filter(project => {
    const updated = new Date(project.updatedAt).getTime();
    return Number.isFinite(updated) && updated < threshold && project.status !== 'archived';
  }).sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
}

function renderDashboard() {
  const visible = visibleProjects();
  refs.projectCount.textContent = state.projects.length;
  refs.resultsLabel.textContent = `${visible.length} ${visible.length === 1 ? 'project' : 'projects'}`;
  const label = state.activeFilter === 'all' ? 'All projects' : statusName(state.activeFilter);
  refs.activeFilterLabel.textContent = label;
  refs.filterButtonLabel.textContent = label;
  $$('.segmented-button').forEach(button => button.classList.toggle('active', button.dataset.view === state.currentView));
  refs.projectGrid.classList.toggle('list-view', state.currentView === 'list');

  const active = state.projects.filter(project => project.status === 'active').length;
  const domains = state.projects.reduce((total, project) => total + (project.domains?.length || 0), 0);
  const deployments = state.projects.reduce((total, project) => total + (project.deployments?.length || 0), 0);
  $('#statProjects').textContent = state.projects.length;
  $('#statActive').textContent = active;
  $('#statDomains').textContent = domains;
  $('#statDeployments').textContent = deployments;

  const expiring = expiringDomains().filter(item => item.days <= 45);
  const stale = staleProjects();
  const incomplete = state.projects.filter(project => projectHealth(project).score < 63).length;
  $('#insightExpiring').textContent = expiring.length;
  $('#insightStale').textContent = stale.length;
  $('#insightIncomplete').textContent = incomplete;

  if (!visible.length) {
    refs.projectGrid.innerHTML = `<div class="empty-state"><span class="empty-mark">S</span><h3>No projects here yet.</h3><p>Try another search or create a fresh entry.</p><button class="button button-primary" type="button" data-action="create">Add a project <span>→</span></button></div>`;
    return;
  }

  refs.projectGrid.innerHTML = visible.map((project, index) => {
    const domain = project.domains?.[0]?.hostname || '';
    const deployment = project.deployments?.find(item => item.environment === 'production') || project.deployments?.[0];
    const technologies = (project.technologies || []).slice(0, 4);
    const description = project.description || project.notes || 'No description yet. Capture the context that will help future you.';
    const health = projectHealth(project);
    return `<article class="project-card" data-id="${escapeHTML(project.id)}" style="animation-delay:${index * 45}ms">
      <div class="card-top"><span class="card-index">${String(index + 1).padStart(2, '0')}</span><span class="status-pill ${escapeHTML(statusTone(project.status))}"><i></i>${statusName(project.status)}</span></div>
      <div class="card-title-row"><h3>${escapeHTML(project.name)}</h3>${project.priority === 'high' ? '<span class="priority-dot" title="High priority">!</span>' : ''}</div>
      <p class="card-description">${escapeHTML(description)}</p>
      <div class="card-health"><div><span>Project health</span><strong>${health.score}%</strong></div><div class="health-track"><i style="width:${health.score}%"></i></div></div>
      <div class="card-tags">${technologies.map(item => `<span>${escapeHTML(item.name)}</span>`).join('')}</div>
      <div class="card-footer"><span class="stack-label">${escapeHTML(healthLabel(health.score))}</span>${domain ? `<span class="card-domain">${escapeHTML(domain)}</span>` : ''}</div>
      <div class="card-actions"><button type="button" data-action="open" aria-label="Open project">↗</button><button type="button" data-action="edit" aria-label="Edit project">✎</button><button type="button" data-action="delete" aria-label="Delete project">×</button></div>
      ${deployment?.url ? `<a class="card-hit-link" href="${escapeHTML(normalizeURL(deployment.url))}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHTML(project.name)} deployment"></a>` : ''}
    </article>`;
  }).join('');
}

function detailSection(title, kicker, content, className = '') {
  return `<section class="detail-section ${className}"><div class="detail-section-heading"><span>${escapeHTML(kicker)}</span><h3>${escapeHTML(title)}</h3></div>${content}</section>`;
}

function metaList(items, empty = 'Nothing tracked yet.') {
  if (!items?.length) return `<div class="detail-empty">${escapeHTML(empty)}</div>`;
  return `<div class="meta-list">${items}</div>`;
}

function renderDetail(project) {
  state.currentProject = project;
  setPage('detail');
  const health = projectHealth(project);
  refs.detailHeader.innerHTML = `<div class="detail-title-wrap"><div class="detail-kicker"><span class="status-pill ${escapeHTML(statusTone(project.status))}"><i></i>${statusName(project.status)}</span><span class="detail-slash">/</span>${escapeHTML(project.category || 'Project')}</div><h1>${escapeHTML(project.name)}</h1><p>${escapeHTML(project.description || 'No description added yet.')}</p><div class="detail-meta"><span>Updated ${relativeDate(project.updatedAt)}</span><span>Created ${relativeDate(project.createdAt)}</span><span>Health ${health.score}%</span></div></div><div class="detail-actions"><button class="button button-quiet" id="detailEditButton" type="button">Edit project</button><button class="button button-danger" id="detailDeleteButton" type="button">Delete</button></div>`;

  const domains = project.domains?.map(item => `<div class="resource-card"><div><strong>${escapeHTML(item.hostname)}</strong><p>${escapeHTML([item.registrar, item.dnsProvider].filter(Boolean).join(' · ') || 'Provider details not added')}</p></div><div class="resource-meta">${item.expiresAt ? `<span>Expires ${escapeHTML(item.expiresAt)}</span>` : '<span>No expiry date</span>'}${item.autoRenew ? '<span>Auto-renew on</span>' : ''}</div></div>`).join('');
  const deployments = project.deployments?.map(item => `<div class="resource-card"><div><strong>${escapeHTML(item.name || 'Deployment')}</strong><p>${escapeHTML([item.provider, item.environment, item.status].filter(Boolean).join(' · ') || 'Provider details not added')}</p>${item.repository ? `<p class="mono-line">${escapeHTML(item.repository)}${item.branch ? ` · ${escapeHTML(item.branch)}` : ''}</p>` : ''}</div><div class="resource-meta">${item.url ? `<a href="${escapeHTML(normalizeURL(item.url))}" target="_blank" rel="noopener noreferrer">Open ↗</a>` : '<span>No URL</span>'}</div></div>`).join('');
  const databases = project.databases?.map(item => `<div class="resource-card"><div><strong>${escapeHTML(item.name || 'Database')}</strong><p>${escapeHTML([item.provider, item.databaseType, item.environment].filter(Boolean).join(' · ') || 'Database details not added')}</p></div><div class="resource-meta">${item.url ? `<a href="${escapeHTML(normalizeURL(item.url))}" target="_blank" rel="noopener noreferrer">Console ↗</a>` : '<span>Internal connection</span>'}</div></div>`).join('');
  const links = project.links?.map(item => `<a class="link-card" href="${escapeHTML(normalizeURL(item.url))}" target="_blank" rel="noopener noreferrer"><span>${escapeHTML(item.label)}</span><small>${escapeHTML(item.url)}</small><b>↗</b></a>`).join('');
  const tags = project.technologies?.map(item => `<span class="technology-chip">${escapeHTML(item.name)}<small>${escapeHTML(item.kind || 'other')}</small></span>`).join('');
  const activity = (project.activities || []).map(item => `<div class="activity-item"><div class="activity-dot"></div><div><strong>${escapeHTML(item.action)}</strong><p>${escapeHTML(item.detail || '')}</p></div><time>${relativeTime(item.createdAt)}</time></div>`).join('');
  const healthChecks = [
    ['Description', Boolean(project.description?.trim())], ['Category', Boolean(project.category?.trim())], ['Technology', Boolean(project.technologies?.length)], ['Domains', Boolean(project.domains?.length)], ['Deployments', Boolean(project.deployments?.length)], ['Databases', Boolean(project.databases?.length)], ['Links', Boolean(project.links?.length)], ['Notes', Boolean(project.notes?.trim())],
  ];
  const healthContent = `<div class="health-hero"><div><span>${healthLabel(health.score)}</span><strong>${health.score}%</strong></div><div class="health-track large"><i style="width:${health.score}%"></i></div></div><div class="health-checks">${healthChecks.map(([label, ok]) => `<div class="health-check ${ok ? 'ok' : ''}"><span>${ok ? '✓' : '·'}</span>${label}</div>`).join('')}</div>`;

  refs.detailGrid.innerHTML = [
    detailSection('Project health', '00', healthContent, 'health-section'),
    detailSection('Domains', '01', metaList(domains, 'No domains attached.')),
    detailSection('Deployments', '02', metaList(deployments, 'No deployment environments attached.')),
    detailSection('Databases', '03', metaList(databases, 'No databases attached.')),
    detailSection('Technology', '04', tags ? `<div class="technology-grid">${tags}</div>` : '<div class="detail-empty">No technologies tracked yet.</div>'),
    detailSection('Links', '05', metaList(links, 'No links attached.')),
    detailSection('Notes', '06', `<div class="notes-card">${escapeHTML(project.notes || 'No notes added yet.')}</div>`),
    detailSection('Activity', '07', activity ? `<div class="activity-list">${activity}</div>` : '<div class="detail-empty">No activity yet.</div>', 'activity-section'),
  ].join('');

  $('#detailEditButton').addEventListener('click', () => openProjectModal(project));
  $('#detailDeleteButton').addEventListener('click', () => deleteProject(project.id));
}

function renderDomainsPage() {
  const domains = state.projects.flatMap(project => (project.domains || []).map(domain => ({ project, domain, days: daysUntil(domain.expiresAt) }))).sort((a, b) => {
    if (a.days === null) return 1;
    if (b.days === null) return -1;
    return a.days - b.days;
  });
  if (!domains.length) {
    refs.domainsTable.innerHTML = `<div class="empty-state compact"><span class="empty-mark">@</span><h3>No domains tracked yet.</h3><p>Add a domain inside a project to see the whole portfolio here.</p><button class="button button-primary" type="button" data-global-action="create">Add a project <span>→</span></button></div>`;
    return;
  }
  refs.domainsTable.innerHTML = `<div class="table-head"><span>Domain</span><span>Project</span><span>Registrar / DNS</span><span>Expiry</span></div>${domains.map(({ project, domain, days }) => `<button class="table-row" type="button" data-domain-project="${escapeHTML(project.id)}"><span class="domain-name">${escapeHTML(domain.hostname)}</span><span>${escapeHTML(project.name)}</span><span>${escapeHTML([domain.registrar, domain.dnsProvider].filter(Boolean).join(' · ') || 'Not added')}</span><span class="expiry-cell ${days !== null && days <= 45 ? 'attention' : ''}">${domain.expiresAt ? `${escapeHTML(domain.expiresAt)}${days !== null ? ` · ${days < 0 ? 'expired' : `${days}d`}` : ''}` : 'No expiry'}</span></button>`).join('')}`;
}

function renderAttentionPage() {
  const expiring = expiringDomains().filter(item => item.days >= 0);
  const stale = staleProjects();
  const incomplete = state.projects.filter(project => projectHealth(project).score < 63).sort((a, b) => projectHealth(a).score - projectHealth(b).score);
  const cards = [
    `<section class="attention-card"><div class="attention-card-head"><div><span class="attention-kicker">Domains</span><h3>Expiring or expired</h3></div><strong>${expiring.length}</strong></div>${expiring.length ? `<div class="attention-list">${expiring.map(item => `<button type="button" class="attention-row" data-attention-project="${escapeHTML(item.project.id)}"><span>${escapeHTML(item.domain.hostname)}</span><small>${escapeHTML(item.project.name)} · ${item.days} days</small><b>→</b></button>`).join('')}</div>` : '<p class="attention-empty">No domains are within the next 45 days.</p>'}</section>`,
    `<section class="attention-card"><div class="attention-card-head"><div><span class="attention-kicker">Projects</span><h3>Quiet for 60+ days</h3></div><strong>${stale.length}</strong></div>${stale.length ? `<div class="attention-list">${stale.map(project => `<button type="button" class="attention-row" data-attention-project="${escapeHTML(project.id)}"><span>${escapeHTML(project.name)}</span><small>Updated ${relativeDate(project.updatedAt)}</small><b>→</b></button>`).join('')}</div>` : '<p class="attention-empty">Nothing has gone quiet yet.</p>'}</section>`,
    `<section class="attention-card"><div class="attention-card-head"><div><span class="attention-kicker">Completeness</span><h3>Projects needing details</h3></div><strong>${incomplete.length}</strong></div>${incomplete.length ? `<div class="attention-list">${incomplete.map(project => `<button type="button" class="attention-row" data-attention-project="${escapeHTML(project.id)}"><span>${escapeHTML(project.name)}</span><small>${projectHealth(project).score}% complete</small><b>→</b></button>`).join('')}</div>` : '<p class="attention-empty">Your project records are looking complete.</p>'}</section>`,
  ];
  refs.attentionGrid.innerHTML = cards.join('');
}

function resetRepeaterContainer(selector) { $(selector).innerHTML = ''; }

function addDomainField(item = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'repeat-row domain-row';
  wrapper.innerHTML = `<div class="repeat-main domain-main"><input data-key="hostname" placeholder="example.com" value="${escapeHTML(item.hostname || '')}"/><input data-key="registrar" placeholder="Registrar" value="${escapeHTML(item.registrar || '')}"/><input data-key="dnsProvider" placeholder="DNS provider" value="${escapeHTML(item.dnsProvider || '')}"/><input data-key="expiresAt" type="date" value="${escapeHTML(item.expiresAt || '')}"/><label class="check-field"><input data-key="autoRenew" type="checkbox" ${item.autoRenew ? 'checked' : ''}/> auto-renew</label><input data-key="notes" placeholder="Notes" value="${escapeHTML(item.notes || '')}"/></div><button type="button" class="remove-row" aria-label="Remove domain">×</button>`;
  $('.remove-row', wrapper).addEventListener('click', () => wrapper.remove());
  $('#domainsFields').appendChild(wrapper);
}

function addDeploymentField(item = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'repeat-row deployment-row';
  wrapper.innerHTML = `<div class="repeat-main"><input data-key="name" placeholder="Production" value="${escapeHTML(item.name || '')}"/><input data-key="provider" placeholder="Vercel, Render, Railway..." value="${escapeHTML(item.provider || '')}"/><select data-key="environment"><option value="production">Production</option><option value="staging">Staging</option><option value="development">Development</option><option value="preview">Preview</option></select><input data-key="url" placeholder="https://..." value="${escapeHTML(item.url || '')}"/><input data-key="repository" placeholder="Repository URL" value="${escapeHTML(item.repository || '')}"/><input data-key="branch" placeholder="Branch" value="${escapeHTML(item.branch || '')}"/><select data-key="status"><option value="active">Active</option><option value="paused">Paused</option><option value="unknown">Unknown</option></select><input data-key="notes" placeholder="Notes" value="${escapeHTML(item.notes || '')}"/></div><button type="button" class="remove-row" aria-label="Remove deployment">×</button>`;
  $('.remove-row', wrapper).addEventListener('click', () => wrapper.remove());
  $('#deploymentsFields').appendChild(wrapper);
}

function addDatabaseField(item = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'repeat-row database-row';
  wrapper.innerHTML = `<div class="repeat-main"><input data-key="name" placeholder="Primary database" value="${escapeHTML(item.name || '')}"/><input data-key="provider" placeholder="Neon, Supabase, Atlas..." value="${escapeHTML(item.provider || '')}"/><input data-key="databaseType" placeholder="PostgreSQL" value="${escapeHTML(item.databaseType || '')}"/><select data-key="environment"><option value="production">Production</option><option value="staging">Staging</option><option value="development">Development</option></select><input data-key="url" placeholder="Console URL" value="${escapeHTML(item.url || '')}"/><input data-key="notes" placeholder="Notes" value="${escapeHTML(item.notes || '')}"/></div><button type="button" class="remove-row" aria-label="Remove database">×</button>`;
  $('.remove-row', wrapper).addEventListener('click', () => wrapper.remove());
  $('#databasesFields').appendChild(wrapper);
}

function addLinkField(item = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'repeat-row link-row';
  wrapper.innerHTML = `<div class="repeat-main"><input data-key="label" placeholder="GitHub" value="${escapeHTML(item.label || '')}"/><input data-key="url" placeholder="https://..." value="${escapeHTML(item.url || '')}"/><select data-key="kind"><option value="github">GitHub</option><option value="production">Production</option><option value="figma">Figma</option><option value="linear">Linear</option><option value="docs">Docs</option><option value="other">Other</option></select></div><button type="button" class="remove-row" aria-label="Remove link">×</button>`;
  $('.remove-row', wrapper).addEventListener('click', () => wrapper.remove());
  $('#linksFields').appendChild(wrapper);
}

function collectRows(containerSelector, fields) {
  return $$('.repeat-row', $(containerSelector)).map(row => Object.fromEntries(fields.map(key => {
    const control = $(`[data-key="${key}"]`, row);
    return [key, control?.type === 'checkbox' ? Boolean(control.checked) : (control?.value.trim() || '')];
  }))).filter(item => Object.entries(item).some(([key, value]) => key === 'autoRenew' ? value : Boolean(value)));
}

function formToProject() {
  const fd = new FormData(refs.projectForm);
  const technologyNames = String(fd.get('technologies') || '').split(',').map(name => name.trim()).filter(Boolean);
  return {
    name: String(fd.get('name') || '').trim(),
    description: String(fd.get('description') || '').trim(),
    status: String(fd.get('status') || 'active'),
    priority: String(fd.get('priority') || 'normal'),
    category: String(fd.get('category') || '').trim(),
    technologies: technologyNames.map(name => ({ name, kind: 'stack' })),
    domains: collectRows('#domainsFields', ['hostname', 'registrar', 'dnsProvider', 'expiresAt', 'autoRenew', 'notes']).map(item => ({ ...item, hostname: item.hostname.toLowerCase() })),
    deployments: collectRows('#deploymentsFields', ['name', 'provider', 'environment', 'url', 'repository', 'branch', 'status', 'notes']).map(item => ({ ...item, url: normalizeURL(item.url), repository: normalizeURL(item.repository) })),
    databases: collectRows('#databasesFields', ['name', 'provider', 'databaseType', 'environment', 'url', 'notes']).map(item => ({ ...item, url: normalizeURL(item.url) })),
    links: collectRows('#linksFields', ['label', 'url', 'kind']).map(item => ({ ...item, url: normalizeURL(item.url) })),
    notes: String(fd.get('notes') || '').trim(),
  };
}

function projectToForm(project) {
  refs.projectForm.elements.name.value = project.name || '';
  refs.projectForm.elements.description.value = project.description || '';
  refs.projectForm.elements.status.value = project.status || 'active';
  refs.projectForm.elements.priority.value = project.priority || 'normal';
  refs.projectForm.elements.category.value = project.category || '';
  refs.projectForm.elements.technologies.value = (project.technologies || []).map(item => item.name).join(', ');
  refs.projectForm.elements.notes.value = project.notes || '';
  resetRepeaterContainer('#domainsFields');
  resetRepeaterContainer('#deploymentsFields');
  resetRepeaterContainer('#databasesFields');
  resetRepeaterContainer('#linksFields');
  (project.domains || []).forEach(addDomainField);
  (project.deployments || []).forEach(addDeploymentField);
  (project.databases || []).forEach(addDatabaseField);
  (project.links || []).forEach(addLinkField);
}

function openProjectModal(project = null) {
  state.editing = Boolean(project);
  refs.formError.hidden = true;
  refs.modalBackdrop.hidden = false;
  document.body.classList.add('modal-open');
  refs.modalEyebrow.innerHTML = project ? 'Edit entry <span class="eyebrow-line"></span>' : 'New entry <span class="eyebrow-line"></span>';
  refs.modalTitle.textContent = project ? 'Edit this project.' : 'Add a project.';
  refs.saveProjectButton.innerHTML = project ? 'Save changes <span>→</span>' : 'Create project <span>→</span>';
  refs.projectForm.reset();
  resetRepeaterContainer('#domainsFields');
  resetRepeaterContainer('#deploymentsFields');
  resetRepeaterContainer('#databasesFields');
  resetRepeaterContainer('#linksFields');
  if (project) projectToForm(project);
  else { addDomainField(); addDeploymentField(); addDatabaseField(); addLinkField(); }
  setTimeout(() => refs.projectForm.elements.name.focus(), 0);
}

function closeProjectModal() {
  refs.modalBackdrop.hidden = true;
  document.body.classList.remove('modal-open');
  refs.formError.hidden = true;
}

async function saveProject(event) {
  event.preventDefault();
  refs.formError.hidden = true;
  const project = formToProject();
  if (!project.name) { refs.formError.textContent = 'Project name is required.'; refs.formError.hidden = false; return; }
  refs.saveProjectButton.disabled = true;
  try {
    const saved = state.editing && state.currentProject
      ? await api(`/api/projects/${encodeURIComponent(state.currentProject.id)}`, { method: 'PATCH', body: JSON.stringify(project) })
      : await api('/api/projects', { method: 'POST', body: JSON.stringify(project) });
    const index = state.projects.findIndex(item => item.id === saved.id);
    if (index >= 0) state.projects[index] = saved; else state.projects.unshift(saved);
    state.currentProject = saved;
    closeProjectModal();
    renderDashboard();
    showToast(state.editing ? 'Project updated.' : 'Project created.');
    renderDetail(saved);
  } catch (error) {
    if (error.message.includes('Failed to fetch')) {
      const fallback = { ...project, id: state.currentProject?.id || `local-${Date.now()}`, activities: [{ action: state.editing ? 'updated' : 'created', detail: state.editing ? 'Project details updated.' : 'Project created.', createdAt: new Date().toISOString() }], createdAt: state.currentProject?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
      if (state.editing) state.projects = state.projects.map(item => item.id === fallback.id ? fallback : item);
      else state.projects.unshift(fallback);
      state.currentProject = fallback;
      closeProjectModal();
      renderDashboard();
      renderDetail(fallback);
      showToast('Saved in local preview mode.');
      return;
    }
    refs.formError.textContent = error.message;
    refs.formError.hidden = false;
  } finally {
    refs.saveProjectButton.disabled = false;
  }
}

async function deleteProject(id) {
  const project = state.projects.find(item => item.id === id);
  if (!project) return;
  if (!window.confirm(`Delete “${project.name}”? This cannot be undone.`)) return;
  try {
    await api(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (error) {
    if (!error.message.includes('Failed to fetch')) { showToast(error.message); return; }
  }
  state.projects = state.projects.filter(item => item.id !== id);
  state.currentProject = null;
  setPage('projects');
  renderDashboard();
  showToast('Project deleted.');
}

function handleProjectGridClick(event) {
  const action = event.target.closest('[data-action]');
  if (!action) return;
  if (action.dataset.action === 'create') { openProjectModal(); return; }
  const card = event.target.closest('.project-card');
  if (!card) return;
  const project = state.projects.find(item => item.id === card.dataset.id);
  if (!project) return;
  if (action.dataset.action === 'open') renderDetail(project);
  if (action.dataset.action === 'edit') openProjectModal(project);
  if (action.dataset.action === 'delete') deleteProject(project.id);
}

function openCommandPalette() {
  state.commandOpen = true;
  refs.commandBackdrop.hidden = false;
  refs.commandInput.value = '';
  renderCommandItems();
  setTimeout(() => refs.commandInput.focus(), 0);
}

function closeCommandPalette() {
  state.commandOpen = false;
  refs.commandBackdrop.hidden = true;
}

function renderCommandItems() {
  const query = refs.commandInput.value.trim().toLowerCase();
  const items = [
    { label: 'New project', meta: 'Create a project record', action: 'create', icon: '+' },
    { label: 'Search projects', meta: 'Jump to project search', action: 'search', icon: '⌕' },
    { label: 'Open domains', meta: 'View every tracked domain', action: 'domains', icon: '@' },
    { label: 'Open attention', meta: 'Review items that need attention', action: 'attention', icon: '!' },
  ].filter(item => !query || `${item.label} ${item.meta}`.toLowerCase().includes(query));
  refs.commandList.innerHTML = items.length ? items.map((item, index) => `<button class="command-item" type="button" data-command="${item.action}" data-index="${index}"><span class="command-icon">${item.icon}</span><span><strong>${item.label}</strong><small>${item.meta}</small></span><kbd>${index + 1}</kbd></button>`).join('') : '<div class="command-empty">No matching actions.</div>';
}

async function signOut() {
  try { await api('/api/auth/sign-out', { method: 'POST', body: '{}' }); } catch (error) { console.error(error); }
  state.user = null;
  refs.profileMenu.hidden = true;
  refs.appShell.hidden = true;
  refs.authGate.hidden = false;
  setAuthMode('signin');
  refs.authForm.reset();
}

refs.authForm.addEventListener('submit', submitAuth);
refs.googleButton.addEventListener('click', continueWithGoogle);
$$('.auth-tab').forEach(tab => tab.addEventListener('click', () => setAuthMode(tab.dataset.authMode)));
$('#openCreateButton').addEventListener('click', () => openProjectModal());
$('#closeModalButton').addEventListener('click', closeProjectModal);
$('#cancelButton').addEventListener('click', closeProjectModal);
refs.modalBackdrop.addEventListener('click', event => { if (event.target === refs.modalBackdrop) closeProjectModal(); });
refs.projectForm.addEventListener('submit', saveProject);
refs.projectGrid.addEventListener('click', handleProjectGridClick);
refs.searchInput.addEventListener('input', renderDashboard);
$('#backToProjects').addEventListener('click', () => { setPage('projects'); renderDashboard(); });

$('#filterButton').addEventListener('click', () => {
  refs.filterMenu.hidden = !refs.filterMenu.hidden;
  refs.filterButton.setAttribute('aria-expanded', String(!refs.filterMenu.hidden));
});
refs.filterMenu.addEventListener('click', event => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  state.activeFilter = button.dataset.filter;
  refs.filterMenu.hidden = true;
  refs.filterButton.setAttribute('aria-expanded', 'false');
  renderDashboard();
});

$$('.segmented-button').forEach(button => button.addEventListener('click', () => { state.currentView = button.dataset.view; renderDashboard(); }));
$$('.nav-item').forEach(button => button.addEventListener('click', () => {
  const page = button.dataset.nav;
  setPage(page);
  if (page === 'projects') renderDashboard();
}));

$$('[data-add]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.add === 'domain') addDomainField();
  if (button.dataset.add === 'deployment') addDeploymentField();
  if (button.dataset.add === 'database') addDatabaseField();
  if (button.dataset.add === 'link') addLinkField();
}));

refs.avatarButton.addEventListener('click', () => {
  refs.profileMenu.hidden = !refs.profileMenu.hidden;
  refs.avatarButton.setAttribute('aria-expanded', String(!refs.profileMenu.hidden));
});
$('#signOutButton').addEventListener('click', signOut);

refs.domainsTable.addEventListener('click', event => {
  const button = event.target.closest('[data-domain-project]');
  if (!button) return;
  const project = state.projects.find(item => item.id === button.dataset.domainProject);
  if (project) renderDetail(project);
});
refs.domainsTable.addEventListener('click', event => {
  if (event.target.closest('[data-global-action="create"]')) openProjectModal();
});
refs.attentionGrid.addEventListener('click', event => {
  const button = event.target.closest('[data-attention-project]');
  if (!button) return;
  const project = state.projects.find(item => item.id === button.dataset.attentionProject);
  if (project) renderDetail(project);
});

refs.commandInput.addEventListener('input', renderCommandItems);
refs.commandBackdrop.addEventListener('click', event => { if (event.target === refs.commandBackdrop) closeCommandPalette(); });
refs.commandList.addEventListener('click', event => {
  const button = event.target.closest('[data-command]');
  if (!button) return;
  const action = button.dataset.command;
  closeCommandPalette();
  if (action === 'create') openProjectModal();
  if (action === 'search') { setPage('projects'); renderDashboard(); refs.searchInput.focus(); }
  if (action === 'domains') setPage('domains');
  if (action === 'attention') setPage('attention');
});

document.addEventListener('click', event => {
  if (!event.target.closest('.topbar-actions')) refs.profileMenu.hidden = true;
  if (!event.target.closest('.filter-wrap')) { refs.filterMenu.hidden = true; refs.filterButton.setAttribute('aria-expanded', 'false'); }
});

document.addEventListener('keydown', event => {
  if (event.key === '/' && document.activeElement !== refs.searchInput && refs.modalBackdrop.hidden && refs.commandBackdrop.hidden) { event.preventDefault(); setPage('projects'); refs.searchInput.focus(); }
  if (event.key === 'Escape') {
    if (!refs.commandBackdrop.hidden) closeCommandPalette();
    else if (!refs.modalBackdrop.hidden) closeProjectModal();
    else refs.profileMenu.hidden = true;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (refs.commandBackdrop.hidden) openCommandPalette(); else closeCommandPalette(); }
  if (!refs.commandBackdrop.hidden && /^[1-4]$/.test(event.key)) {
    const item = $('.command-item[data-index="' + (Number(event.key) - 1) + '"]');
    if (item) item.click();
  }
});

loadSession();
