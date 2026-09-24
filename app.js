const state = {
  projects: [],
  currentProject: null,
  activeFilter: 'all',
  currentView: 'grid',
  authMode: 'signin',
  editing: false,
  user: null,
  commandOpen: false,
  github: { connected: false, configured: false, connection: null, repositoryCount: 0 },
  githubRepositories: [],
  githubPickerProject: null,
  vault: {
    exists: false,
    record: null,
    masterKey: null,
    unlocked: false,
  },
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
  integrationsView: $('#integrationsView'),
  githubIntegrationCard: $('#githubIntegrationCard'),
  githubPickerBackdrop: $('#githubPickerBackdrop'),
  githubPickerTitle: $('#githubPickerTitle'),
  githubRepoSearch: $('#githubRepoSearch'),
  githubRepoList: $('#githubRepoList'),
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

function ensureVaultUI() {
  if ($('#privacyVaultBackdrop')) return;

  const style = document.createElement('style');
  style.id = 'privacyVaultStyles';
  style.textContent = `
    .privacy-vault-backdrop {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgba(18, 18, 16, .58);
      backdrop-filter: blur(12px);
    }
    .privacy-vault-backdrop[hidden] { display: none; }
    .privacy-vault-card {
      width: min(520px, 100%);
      border: 1px solid rgba(24, 24, 21, .16);
      border-radius: 22px;
      background: #f6f3ec;
      box-shadow: 0 30px 90px rgba(0, 0, 0, .24);
      padding: 28px;
      color: #181815;
    }
    .privacy-vault-kicker {
      margin: 0 0 10px;
      font: 500 11px/1.2 "DM Mono", monospace;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: #2f7651;
    }
    .privacy-vault-card h2 {
      margin: 0;
      font: 600 30px/1.05 "Space Grotesk", sans-serif;
      letter-spacing: -.035em;
    }
    .privacy-vault-copy {
      margin: 14px 0 20px;
      color: rgba(24,24,21,.68);
      line-height: 1.55;
    }
    .privacy-vault-notice {
      margin: 0 0 18px;
      padding: 12px 14px;
      border: 1px solid rgba(47,118,81,.20);
      border-radius: 12px;
      background: rgba(47,118,81,.06);
      font-size: 13px;
      line-height: 1.45;
    }
    .privacy-vault-field {
      display: grid;
      gap: 7px;
      margin-top: 14px;
      font-size: 12px;
      font-weight: 600;
    }
    .privacy-vault-field input {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid rgba(24,24,21,.18);
      border-radius: 12px;
      background: rgba(255,255,255,.55);
      padding: 13px 14px;
      color: #181815;
      font: inherit;
      outline: none;
    }
    .privacy-vault-field input:focus {
      border-color: rgba(47,118,81,.65);
      box-shadow: 0 0 0 3px rgba(47,118,81,.10);
    }
    .privacy-vault-error {
      margin: 12px 0 0;
      color: #a1362f;
      font-size: 13px;
    }
    .privacy-vault-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 20px;
    }
    .privacy-vault-submit {
      min-width: 150px;
    }
  `;
  document.head.appendChild(style);

  const backdrop = document.createElement('div');
  backdrop.id = 'privacyVaultBackdrop';
  backdrop.className = 'privacy-vault-backdrop';
  backdrop.hidden = true;
  backdrop.innerHTML = `
    <section class="privacy-vault-card" role="dialog" aria-modal="true" aria-labelledby="privacyVaultTitle">
      <p class="privacy-vault-kicker">Private vault</p>
      <h2 id="privacyVaultTitle">Unlock your workspace.</h2>
      <p class="privacy-vault-copy" id="privacyVaultCopy"></p>
      <div class="privacy-vault-notice" id="privacyVaultNotice"></div>
      <form id="privacyVaultForm">
        <label class="privacy-vault-field">
          Vault passphrase
          <input id="privacyVaultPassphrase" type="password" required />
        </label>
        <label class="privacy-vault-field" id="privacyVaultConfirmField" hidden>
          Confirm passphrase
          <input id="privacyVaultConfirm" type="password" />
        </label>
        <p class="privacy-vault-error" id="privacyVaultError" hidden></p>
        <div class="privacy-vault-actions">
          <button class="button button-primary privacy-vault-submit" id="privacyVaultSubmit" type="submit">Unlock vault <span>→</span></button>
        </div>
      </form>
    </section>
  `;
  document.body.appendChild(backdrop);
}

function requestVaultPassphrase(mode = 'unlock') {
  ensureVaultUI();

  const backdrop = $('#privacyVaultBackdrop');
  const form = $('#privacyVaultForm');
  const title = $('#privacyVaultTitle');
  const copy = $('#privacyVaultCopy');
  const notice = $('#privacyVaultNotice');
  const passphraseInput = $('#privacyVaultPassphrase');
  const confirmField = $('#privacyVaultConfirmField');
  const confirmInput = $('#privacyVaultConfirm');
  const error = $('#privacyVaultError');
  const submit = $('#privacyVaultSubmit');

  const setup = mode === 'setup';
  title.textContent = setup ? 'Create your private vault.' : 'Unlock your private vault.';
  copy.textContent = setup
    ? 'Your project content will be encrypted in this browser before it is sent to Stackroom.'
    : 'Enter your vault passphrase to decrypt your project content locally in this browser.';
  notice.textContent = setup
    ? 'Stackroom never receives this passphrase and cannot recover it. If you lose it, encrypted project content cannot be recovered.'
    : 'Your passphrase stays in this browser session and is never sent to the Stackroom server.';
  confirmField.hidden = !setup;
  confirmInput.required = setup;
  passphraseInput.autocomplete = setup ? 'new-password' : 'current-password';
  confirmInput.autocomplete = 'new-password';
  submit.innerHTML = setup ? 'Create vault <span>→</span>' : 'Unlock vault <span>→</span>';
  error.hidden = true;
  error.textContent = '';
  passphraseInput.value = '';
  confirmInput.value = '';
  backdrop.hidden = false;
  document.body.classList.add('modal-open');

  return new Promise(resolve => {
    form.onsubmit = event => {
      event.preventDefault();
      const passphrase = passphraseInput.value;

      if (setup && passphrase.length < 12) {
        error.textContent = 'Use at least 12 characters for your vault passphrase.';
        error.hidden = false;
        return;
      }
      if (setup && passphrase !== confirmInput.value) {
        error.textContent = 'The passphrases do not match.';
        error.hidden = false;
        return;
      }

      error.hidden = true;
      resolve({
        passphrase,
        close() {
          backdrop.hidden = true;
          document.body.classList.remove('modal-open');
          form.onsubmit = null;
        },
        showError(message) {
          error.textContent = message;
          error.hidden = false;
          passphraseInput.select();
        },
      });
    };

    setTimeout(() => passphraseInput.focus(), 0);
  });
}

async function initializeVault() {
  if (!window.StackroomCrypto) throw new Error('Privacy engine is unavailable.');

  const status = await api('/api/vault');
  state.vault.exists = Boolean(status?.exists);
  state.vault.record = status?.vault || null;

  if (!state.vault.exists) {
    const prompt = await requestVaultPassphrase('setup');
    try {
      const created = await StackroomCrypto.createVault(prompt.passphrase);
      await api('/api/vault', {
        method: 'POST',
        body: JSON.stringify(created.vaultRecord),
      });

      state.vault.exists = true;
      state.vault.record = created.vaultRecord;
      state.vault.masterKey = created.masterKey;
      state.vault.unlocked = true;
      prompt.close();
      showToast('Private vault created.');
      return;
    } catch (error) {
      prompt.showError(error.message || 'Unable to create the private vault.');
      throw error;
    }
  }

  while (!state.vault.unlocked) {
    const prompt = await requestVaultPassphrase('unlock');
    try {
      const masterKey = await StackroomCrypto.unlockVault(prompt.passphrase, state.vault.record);
      state.vault.masterKey = masterKey;
      state.vault.unlocked = true;
      prompt.close();
      showToast('Private vault unlocked.');
    } catch (error) {
      prompt.showError('Incorrect passphrase or the vault record is damaged.');
    }
  }
}

function projectPrivateData(project = {}) {
  return {
    name: String(project.name || ''),
    slug: String(project.slug || ''),
    description: String(project.description || ''),
    status: project.status || 'active',
    category: String(project.category || ''),
    priority: project.priority || 'normal',
    technologies: Array.isArray(project.technologies) ? project.technologies : [],
    domains: Array.isArray(project.domains) ? project.domains : [],
    deployments: Array.isArray(project.deployments) ? project.deployments : [],
    databases: Array.isArray(project.databases) ? project.databases : [],
    links: Array.isArray(project.links) ? project.links : [],
    notes: String(project.notes || ''),
    activities: Array.isArray(project.activities) ? project.activities.slice(0, 24) : [],
  };
}

function hydrateEncryptedProject(record, privateData) {
  return {
    id: record.id,
    ...projectPrivateData(privateData),
    github: record.github || null,
    createdAt: record.createdAt || privateData.createdAt || '',
    updatedAt: record.updatedAt || privateData.updatedAt || '',
    isEncrypted: true,
    encryptionVersion: record.encryptionVersion || 1,
  };
}

async function decryptProjectRecord(record) {
  if (!record?.isEncrypted) return record;
  if (!state.vault.masterKey) throw new Error('Private vault is locked.');
  if (!record.encryptedPayload) throw new Error('Encrypted project payload is missing.');

  const privateData = await StackroomCrypto.decryptJSON(
    state.vault.masterKey,
    record.encryptedPayload
  );

  return hydrateEncryptedProject(record, privateData);
}

async function encryptedProjectRequest(project) {
  if (!state.vault.masterKey) throw new Error('Private vault is locked.');

  const encryptedPayload = await StackroomCrypto.encryptJSON(
    state.vault.masterKey,
    projectPrivateData(project)
  );

  return {
    isEncrypted: true,
    encryptionVersion: encryptedPayload.version,
    encryptedPayload,
  };
}

async function migrateLegacyProjects() {
  const legacyProjects = state.projects.filter(project => !project.isEncrypted && project.id && !String(project.id).startsWith('local-'));
  if (!legacyProjects.length) return;

  let migrated = 0;

  for (const project of legacyProjects) {
    const requestBody = await encryptedProjectRequest(project);
    const record = await api(`/api/projects/${encodeURIComponent(project.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(requestBody),
    });

    const migratedProject = hydrateEncryptedProject(record, project);
    const index = state.projects.findIndex(item => item.id === project.id);
    if (index >= 0) state.projects[index] = migratedProject;
    if (state.currentProject?.id === project.id) state.currentProject = migratedProject;
    migrated += 1;
  }

  if (migrated) {
    showToast(`${migrated} existing ${migrated === 1 ? 'project was' : 'projects were'} encrypted.`);
  }
}


function setPage(page) {
  refs.projectsView.hidden = page !== 'projects';
  refs.detailView.hidden = page !== 'detail';
  refs.domainsView.hidden = page !== 'domains';
  refs.attentionView.hidden = page !== 'attention';
  refs.integrationsView.hidden = page !== 'integrations';
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.nav === page));
  const current = { projects: 'All projects', detail: state.currentProject?.name || 'Project', domains: 'Domains', attention: 'Attention', integrations: 'Integrations' }[page] || 'All projects';
  $('#breadcrumbCurrent').textContent = current;
  if (page === 'domains') renderDomainsPage();
  if (page === 'attention') renderAttentionPage();
  if (page === 'integrations') { renderGithubIntegration(); loadGithubStatus(); }
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
    const params = new URLSearchParams(window.location.search);
    const verifier = params.get('neon_auth_session_verifier');
    const sessionPath = verifier
      ? `/api/auth/get-session?neon_auth_session_verifier=${encodeURIComponent(verifier)}`
      : '/api/auth/get-session';

    const payload = await api(sessionPath);

    if (payload?.user && payload?.session) {
      state.user = payload.user;

      if (verifier) {
        const cleanURL = new URL(window.location.href);
        cleanURL.searchParams.delete('neon_auth_session_verifier');
        window.history.replaceState(window.history.state, '', cleanURL.href);
      }

      enterApp();

      try {
        await initializeVault();
        await loadProjects();
      } catch (error) {
        console.error(error);
        showToast(error.message || 'Unable to unlock the private workspace.');
      }

      const githubStatus = new URLSearchParams(window.location.search).get('github');
      if (githubStatus === 'connected') {
        showToast('GitHub connected.');
        history.replaceState({}, '', window.location.pathname);
      }
      if (githubStatus === 'error') {
        showToast('GitHub connection failed. Please check the integration settings.');
        history.replaceState({}, '', window.location.pathname);
      }
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
  loadGithubStatus();
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
    const payload = await api('/api/auth/sign-in/social', { method: 'POST', body: JSON.stringify({ provider: 'google', callbackURL: window.location.origin + '/' }) });
    const redirectURL = payload?.url || payload?.data?.url;
    if (!redirectURL) throw new Error('Google authentication is not enabled in Neon Auth yet.');
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
    const records = Array.isArray(payload) ? payload : [];
    const projects = [];

    for (const record of records) {
      if (!record?.isEncrypted) {
        projects.push(record);
        continue;
      }

      try {
        projects.push(await decryptProjectRecord(record));
      } catch (error) {
        console.error('Unable to decrypt project', record?.id, error);
        showToast('One encrypted project could not be decrypted.');
      }
    }

    state.projects = projects;
    await migrateLegacyProjects();
  } catch (error) {
    state.projects = [];
    showToast(`Unable to load projects: ${error.message}`);
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
    project.github ? [project.github.fullName, project.github.name, project.github.owner, project.github.defaultBranch, project.github.description].join(' ') : '',
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
    Boolean(project.github),
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
    ['Description', Boolean(project.description?.trim())], ['Category', Boolean(project.category?.trim())], ['Technology', Boolean(project.technologies?.length)], ['Domains', Boolean(project.domains?.length)], ['Deployments', Boolean(project.deployments?.length)], ['Databases', Boolean(project.databases?.length)], ['Links', Boolean(project.links?.length)], ['GitHub', Boolean(project.github)], ['Notes', Boolean(project.notes?.trim())],
  ];
  const healthContent = `<div class="health-hero"><div><span>${healthLabel(health.score)}</span><strong>${health.score}%</strong></div><div class="health-track large"><i style="width:${health.score}%"></i></div></div><div class="health-checks">${healthChecks.map(([label, ok]) => `<div class="health-check ${ok ? 'ok' : ''}"><span>${ok ? '✓' : '·'}</span>${label}</div>`).join('')}</div>`;

  refs.detailGrid.innerHTML = [
    detailSection('Project health', '00', healthContent, 'health-section'),
    detailSection('Domains', '01', metaList(domains, 'No domains attached.')),
    detailSection('Deployments', '02', metaList(deployments, 'No deployment environments attached.')),
    detailSection('Databases', '03', metaList(databases, 'No databases attached.')),
    detailSection('Technology', '04', tags ? `<div class="technology-grid">${tags}</div>` : '<div class="detail-empty">No technologies tracked yet.</div>'),
    detailSection('Links', '05', metaList(links, 'No links attached.')),
    detailSection('GitHub', '06', renderProjectGithub(project)),
    detailSection('Notes', '07', `<div class="notes-card">${escapeHTML(project.notes || 'No notes added yet.')}</div>`),
    detailSection('Activity', '08', activity ? `<div class="activity-list">${activity}</div>` : '<div class="detail-empty">No activity yet.</div>', 'activity-section'),
  ].join('');

  $('#detailEditButton').addEventListener('click', () => openProjectModal(project));
  $('#detailDeleteButton').addEventListener('click', () => deleteProject(project.id));
  const githubAction = $('#detailGithubButton');
  if (githubAction) githubAction.addEventListener('click', () => openGithubPicker(project));
  const githubUnlink = $('#detailGithubUnlink');
  if (githubUnlink) githubUnlink.addEventListener('click', () => unlinkGithubRepository(project));
}


function renderProjectGithub(project) {
  if (project.github) {
    const repo = project.github;
    return `<div class="github-project-card"><div class="github-project-main"><div class="github-logo">GH</div><div><strong>${escapeHTML(repo.fullName)}</strong><p>${escapeHTML([repo.private ? 'Private' : 'Public', repo.defaultBranch ? `Default: ${repo.defaultBranch}` : ''].filter(Boolean).join(' · '))}</p>${repo.description ? `<p>${escapeHTML(repo.description)}</p>` : ''}</div></div><div class="github-project-actions"><a class="button button-quiet" href="${escapeHTML(repo.htmlUrl)}" target="_blank" rel="noopener noreferrer">Open GitHub ↗</a><button class="button button-quiet" id="detailGithubUnlink" type="button">Unlink</button></div></div>`;
  }
  if (!state.github.connected) return `<div class="detail-empty">Connect GitHub to link a repository to this project.</div><button class="button button-primary" type="button" id="detailGithubButton">Connect GitHub <span>→</span></button>`;
  return `<div class="github-unlinked-card"><div><strong>No repository linked.</strong><p>Choose a repository from @${escapeHTML(state.github.connection?.login || 'GitHub')}.</p></div><button class="button button-primary" type="button" id="detailGithubButton">Choose repository <span>→</span></button></div>`;
}

async function loadGithubStatus() {
  try {
    const payload = await api('/api/integrations/github/status');
    state.github = payload || { connected: false, configured: false };
    renderGithubIntegration();
  } catch (error) {
    state.github = { connected: false, configured: false, connection: null, repositoryCount: 0 };
    renderGithubIntegration();
  }
}

function renderGithubIntegration() {
  if (!refs.githubIntegrationCard) return;
  if (!state.github.configured) {
    refs.githubIntegrationCard.innerHTML = `<article class="integration-card"><div class="integration-icon">GH</div><div class="integration-copy"><span class="integration-kicker">GitHub</span><h3>Integration not configured.</h3><p>Add the GitHub App environment variables to the server before connecting.</p><div class="integration-note">Required: client ID, client secret, redirect URI and a 32-byte encryption key.</div></div></article>`;
    return;
  }
  if (!state.github.connected) {
    refs.githubIntegrationCard.innerHTML = `<article class="integration-card"><div class="integration-icon">GH</div><div class="integration-copy"><span class="integration-kicker">GitHub</span><h3>Connect your GitHub account.</h3><p>Import repositories and link them directly to Stackroom projects.</p><button class="button button-primary" id="connectGithubButton" type="button">Connect GitHub <span>→</span></button></div></article>`;
    $('#connectGithubButton')?.addEventListener('click', () => { window.location.href = '/api/integrations/github/connect'; });
    return;
  }
  refs.githubIntegrationCard.innerHTML = `<article class="integration-card connected"><div class="integration-icon">GH</div><div class="integration-copy"><div class="integration-heading"><div><span class="integration-kicker">GitHub</span><h3>@${escapeHTML(state.github.connection?.login || 'connected')}</h3></div><span class="connected-pill"><i></i>Connected</span></div><p>${state.github.repositoryCount || 0} repositories cached for project linking.</p><div class="integration-actions"><button class="button button-quiet" id="refreshGithubButton" type="button">Refresh repositories</button><button class="button button-quiet" id="disconnectGithubButton" type="button">Disconnect</button></div></div></article>`;
  $('#refreshGithubButton')?.addEventListener('click', async () => { await loadGithubRepositories(); showToast('GitHub repositories refreshed.'); });
  $('#disconnectGithubButton')?.addEventListener('click', disconnectGithub);
}

async function disconnectGithub() {
  if (!window.confirm('Disconnect GitHub from Stackroom? Linked repositories will be unlinked from projects.')) return;
  try {
    await api('/api/integrations/github/disconnect', { method: 'POST', body: '{}' });
    state.github = { connected: false, configured: true, connection: null, repositoryCount: 0 };
    state.projects = state.projects.map(project => ({ ...project, github: null }));
    if (state.currentProject) state.currentProject = state.projects.find(project => project.id === state.currentProject.id) || state.currentProject;
    renderGithubIntegration();
    if (state.currentProject) renderDetail(state.currentProject);
    showToast('GitHub disconnected.');
  } catch (error) { showToast(error.message); }
}

async function loadGithubRepositories(query = '') {
  const payload = await api(`/api/github/repositories${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  state.githubRepositories = Array.isArray(payload) ? payload : [];
  renderGithubRepositories();
}

function renderGithubRepositories() {
  if (!state.githubRepositories.length) {
    refs.githubRepoList.innerHTML = '<div class="detail-empty">No repositories found.</div>';
    return;
  }
  refs.githubRepoList.innerHTML = state.githubRepositories.map(repo => {
    const linkedProject = state.projects.find(project => project.id === repo.linkedProjectID);
    const linkedProjectName = linkedProject?.name || 'another project';
    return `<button class="github-repo-item" type="button" data-repository-id="${escapeHTML(repo.id)}" ${repo.linkedProjectID && repo.linkedProjectID !== state.githubPickerProject?.id ? 'disabled' : ''}><div class="github-repo-mark">${repo.private ? 'P' : 'R'}</div><span><strong>${escapeHTML(repo.fullName)}</strong><small>${escapeHTML(repo.description || (repo.defaultBranch ? `Default branch: ${repo.defaultBranch}` : ''))}</small></span><b>${repo.linkedProjectID === state.githubPickerProject?.id ? 'Linked' : repo.linkedProjectID ? `Used by ${escapeHTML(linkedProjectName)}` : 'Link →'}</b></button>`;
  }).join('');
}

async function openGithubPicker(project) {
  if (!state.github.connected) { setPage('integrations'); return; }
  state.githubPickerProject = project;
  refs.githubPickerTitle.textContent = `Link a repository to ${project.name}.`;
  refs.githubPickerBackdrop.hidden = false;
  document.body.classList.add('modal-open');
  refs.githubRepoSearch.value = '';
  refs.githubRepoList.innerHTML = '<div class="detail-empty">Loading repositories...</div>';
  try { await loadGithubRepositories(); } catch (error) { refs.githubRepoList.innerHTML = `<div class="detail-empty">${escapeHTML(error.message)}</div>`; }
  setTimeout(() => refs.githubRepoSearch.focus(), 0);
}

function closeGithubPicker() {
  refs.githubPickerBackdrop.hidden = true;
  document.body.classList.remove('modal-open');
  state.githubPickerProject = null;
}

async function linkGithubRepository(repositoryID) {
  const project = state.githubPickerProject;
  if (!project) return;
  try {
    const repo = await api(`/api/projects/${encodeURIComponent(project.id)}/github`, { method: 'POST', body: JSON.stringify({ repositoryId: repositoryID }) });
    const index = state.projects.findIndex(item => item.id === project.id);
    if (index >= 0) { state.projects[index] = { ...state.projects[index], github: repo }; state.currentProject = state.projects[index]; }
    closeGithubPicker();
    renderDetail(state.currentProject);
    renderDashboard();
    showToast('GitHub repository linked.');
  } catch (error) { showToast(error.message); }
}

async function unlinkGithubRepository(project) {
  if (!window.confirm(`Unlink the GitHub repository from “${project.name}”?`)) return;
  try {
    await api(`/api/projects/${encodeURIComponent(project.id)}/github`, { method: 'DELETE' });
    const index = state.projects.findIndex(item => item.id === project.id);
    if (index >= 0) { state.projects[index] = { ...state.projects[index], github: null }; state.currentProject = state.projects[index]; }
    renderDetail(state.currentProject);
    showToast('GitHub repository unlinked.');
  } catch (error) { showToast(error.message); }
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

function localSlugify(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formToProject() {
  const fd = new FormData(refs.projectForm);
  const technologyNames = String(fd.get('technologies') || '').split(',').map(name => name.trim()).filter(Boolean);
  const name = String(fd.get('name') || '').trim();
  return {
    name,
    slug: localSlugify(name),
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
  if (!project.name) {
    refs.formError.textContent = 'Project name is required.';
    refs.formError.hidden = false;
    return;
  }

  if (!state.vault.unlocked || !state.vault.masterKey) {
    refs.formError.textContent = 'Unlock your private vault before saving projects.';
    refs.formError.hidden = false;
    return;
  }

  const now = new Date().toISOString();

  if (state.editing && state.currentProject) {
    project.slug = state.currentProject.slug || project.slug;
    project.activities = [
      { action: 'updated', detail: 'Project details updated.', createdAt: now },
      ...(state.currentProject.activities || []),
    ].slice(0, 24);
  } else {
    project.activities = [
      { action: 'created', detail: 'Project created.', createdAt: now },
    ];
  }

  refs.saveProjectButton.disabled = true;

  try {
    const requestBody = await encryptedProjectRequest(project);

    const record = state.editing && state.currentProject
      ? await api(`/api/projects/${encodeURIComponent(state.currentProject.id)}`, {
          method: 'PATCH',
          body: JSON.stringify(requestBody),
        })
      : await api('/api/projects', {
          method: 'POST',
          body: JSON.stringify(requestBody),
        });

    const saved = hydrateEncryptedProject(record, project);
    const index = state.projects.findIndex(item => item.id === saved.id);

    if (index >= 0) state.projects[index] = saved;
    else state.projects.unshift(saved);

    state.currentProject = saved;
    const wasEditing = state.editing;
    closeProjectModal();
    renderDashboard();
    showToast(wasEditing ? 'Project encrypted and updated.' : 'Project encrypted and created.');
    renderDetail(saved);
  } catch (error) {
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
    { label: 'Open integrations', meta: 'Connect GitHub and other tools', action: 'integrations', icon: '↗' },
  ].filter(item => !query || `${item.label} ${item.meta}`.toLowerCase().includes(query));
  refs.commandList.innerHTML = items.length ? items.map((item, index) => `<button class="command-item" type="button" data-command="${item.action}" data-index="${index}"><span class="command-icon">${item.icon}</span><span><strong>${item.label}</strong><small>${item.meta}</small></span><kbd>${index + 1}</kbd></button>`).join('') : '<div class="command-empty">No matching actions.</div>';
}

async function signOut() {
  try { await api('/api/auth/sign-out', { method: 'POST', body: '{}' }); } catch (error) { console.error(error); }
  state.user = null;
  state.vault = { exists: false, record: null, masterKey: null, unlocked: false };
  state.projects = [];
  state.currentProject = null;
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

$('#closeGithubPickerButton').addEventListener('click', closeGithubPicker);
refs.githubPickerBackdrop.addEventListener('click', event => { if (event.target === refs.githubPickerBackdrop) closeGithubPicker(); });
refs.githubRepoSearch.addEventListener('input', async () => { try { await loadGithubRepositories(refs.githubRepoSearch.value.trim()); } catch (error) { refs.githubRepoList.innerHTML = `<div class="detail-empty">${escapeHTML(error.message)}</div>`; } });
refs.githubRepoList.addEventListener('click', event => { const button = event.target.closest('[data-repository-id]'); if (button && !button.disabled) linkGithubRepository(button.dataset.repositoryId); });

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
  if (action === 'integrations') setPage('integrations');
});

document.addEventListener('click', event => {
  if (!event.target.closest('.topbar-actions')) refs.profileMenu.hidden = true;
  if (!event.target.closest('.filter-wrap')) { refs.filterMenu.hidden = true; refs.filterButton.setAttribute('aria-expanded', 'false'); }
});

document.addEventListener('keydown', event => {
  if (event.key === '/' && document.activeElement !== refs.searchInput && refs.modalBackdrop.hidden && refs.commandBackdrop.hidden) { event.preventDefault(); setPage('projects'); refs.searchInput.focus(); }
  if (event.key === 'Escape') {
    if (!refs.githubPickerBackdrop.hidden) closeGithubPicker();
    else if (!refs.commandBackdrop.hidden) closeCommandPalette();
    else if (!refs.modalBackdrop.hidden) closeProjectModal();
    else refs.profileMenu.hidden = true;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (refs.commandBackdrop.hidden) openCommandPalette(); else closeCommandPalette(); }
  if (!refs.commandBackdrop.hidden && /^[1-5]$/.test(event.key)) {
    const item = $('.command-item[data-index="' + (Number(event.key) - 1) + '"]');
    if (item) item.click();
  }
});

loadSession();
