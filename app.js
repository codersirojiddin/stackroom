const state = {
  projects: [],
  migration: null,
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
  const generation = vaultGeneration;
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: sessionRequests.signal,
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json().catch(() => ({})) : null;
  assertVaultGeneration(generation);
  if (!response.ok) {
    const error = new Error(apiError(payload, `Request failed (${response.status})`));
    error.status = response.status;
    throw error;
  }
  return payload;
}

// Invalidating the generation prevents pending fetch/crypto work from restoring a locked session.
let vaultGeneration = 0;
let sessionRequests = new AbortController();
let cancelVaultPrompt = null;

function assertVaultGeneration(generation) {
  if (generation !== vaultGeneration) throw new DOMException('Session ended.', 'AbortError');
}

function clearPrivateState() {
  vaultGeneration += 1;
  sessionRequests.abort();
  sessionRequests = new AbortController();
  cancelVaultPrompt?.();
  state.vault = { exists: false, record: null, masterKey: null, unlocked: false };
  state.projects = [];
  state.migration = null;
  $('#migrationStatus').hidden = true;
  $('#migrationMessage').textContent = '';
  $('#retryMigrationButton').hidden = true;
  state.currentProject = null;
  state.githubPickerProject = null;
  state.githubRepositories = [];
  state.github = { connected: false, configured: false, connection: null, repositoryCount: 0 };
  state.editing = false;
  state.commandOpen = false;
  state.activeFilter = 'all';
  refs.projectForm.reset();
  refs.authForm.reset();
  refs.saveProjectButton.disabled = false;
  for (const selector of ['#domainsFields', '#deploymentsFields', '#databasesFields', '#linksFields']) {
    $(selector).replaceChildren();
  }
  for (const node of [refs.projectGrid, refs.detailHeader, refs.detailGrid, refs.domainsTable,
    refs.attentionGrid, refs.githubRepoList, refs.githubIntegrationCard, refs.commandList]) {
    node.replaceChildren();
  }
  for (const input of [refs.searchInput, refs.githubRepoSearch, refs.commandInput]) input.value = '';
  refs.githubPickerTitle.textContent = 'Link a repository';
  refs.formError.textContent = '';
  refs.formError.hidden = true;
  for (const node of [refs.modalBackdrop, refs.githubPickerBackdrop, refs.commandBackdrop,
    refs.profileMenu, refs.filterMenu, refs.toast, $('#privacyVaultBackdrop')]) node.hidden = true;
  $('#privacyVaultForm').reset();
  refs.avatarButton.setAttribute('aria-expanded', 'false');
  refs.filterButton.setAttribute('aria-expanded', 'false');
  clearTimeout(showToast.timer);
  refs.toast.textContent = '';
  document.body.classList.remove('modal-open');
  setPage('projects');
  renderDashboard();
  refs.appShell.inert = true;
  refs.appShell.hidden = true;
}

function initializeVault() {
  const generation = vaultGeneration;
  const backdrop = $('#privacyVaultBackdrop');
  const form = $('#privacyVaultForm');
  const passphraseInput = $('#privacyVaultPassphrase');
  const confirmInput = $('#privacyVaultConfirm');
  const error = $('#privacyVaultError');
  const submit = $('#privacyVaultSubmit');
  let mode = null;
  let busy = false;
  let finished = false;

  refs.appShell.inert = true;
  refs.appShell.hidden = true;
  backdrop.hidden = false;
  document.body.classList.add('modal-open');
  form.reset();
  error.hidden = true;
  error.textContent = '';
  $('#privacyVaultTitle').textContent = 'Your private vault';
  $('#privacyVaultCopy').textContent = 'Checking your vault…';
  $('#privacyVaultFields').hidden = true;
  $('#privacyVaultNotice').hidden = true;
  $('#privacyVaultSignOut').focus();

  return new Promise(resolve => {
    function finish(unlocked) {
      finished = true;
      form.reset();
      form.onsubmit = null;
      form.oninput = null;
      form.removeAttribute('aria-busy');
      backdrop.hidden = true;
      document.body.classList.remove('modal-open');
      cancelVaultPrompt = null;
      resolve(unlocked);
    }
    cancelVaultPrompt = () => finish(false);

    function setBusy(value) {
      busy = value;
      form.setAttribute('aria-busy', String(value));
      passphraseInput.disabled = value;
      confirmInput.disabled = value;
      submit.disabled = value;
      submit.textContent = value
        ? (mode === 'setup' ? 'Creating vault…' : mode === 'unlock' ? 'Unlocking…' : 'Checking vault…')
        : (mode === 'setup' ? 'Create vault' : mode === 'unlock' ? 'Unlock vault' : 'Try again');
    }

    function showError(message, input = null) {
      error.textContent = message;
      error.hidden = false;
      if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
    }

    function configure(status) {
      if (typeof status?.exists !== 'boolean' || (status.exists && !status.vault)) {
        throw new Error('Invalid vault status.');
      }
      state.vault.exists = status.exists;
      state.vault.record = status.vault || null;
      mode = status.exists ? 'unlock' : 'setup';
      const setup = mode === 'setup';
      $('#privacyVaultTitle').textContent = setup ? 'Create your private vault' : 'Unlock your private vault';
      $('#privacyVaultCopy').textContent = setup
        ? 'Your project content is encrypted in this browser before it is sent to Stackroom.'
        : 'Enter your vault passphrase to decrypt your projects in this browser.';
      $('#privacyVaultNotice').textContent = 'If you lose this passphrase, Stackroom cannot recover your encrypted project data.';
      $('#privacyVaultNotice').hidden = !setup;
      $('#privacyVaultFields').hidden = false;
      $('#privacyVaultConfirmField').hidden = !setup;
      confirmInput.required = setup;
      passphraseInput.minLength = setup ? 12 : 1;
      $('#privacyVaultHint').textContent = setup
        ? 'Use at least 12 characters. A few unrelated words make a strong passphrase.'
        : 'Your passphrase is never sent to the server. Reloading this page locks your vault.';
      form.reset();
      passphraseInput.removeAttribute('aria-invalid');
      confirmInput.removeAttribute('aria-invalid');
    }

    async function refreshStatus() {
      setBusy(true);
      error.hidden = true;
      try {
        if (!window.StackroomCrypto || !window.crypto?.subtle) throw new Error('Privacy engine unavailable.');
        const status = await api('/api/vault');
        assertVaultGeneration(generation);
        configure(status);
      } catch (failure) {
        if (generation !== vaultGeneration || finished) return;
        mode = null;
        $('#privacyVaultFields').hidden = true;
        showError('Unable to load your private vault. Check your connection and try again.');
      } finally {
        if (generation === vaultGeneration && !finished) {
          setBusy(false);
          (mode ? passphraseInput : submit).focus();
        }
      }
    }

    form.oninput = () => {
      error.hidden = true;
      passphraseInput.removeAttribute('aria-invalid');
      confirmInput.removeAttribute('aria-invalid');
    };
    form.onsubmit = async event => {
      event.preventDefault();
      if (busy || finished) return;
      if (!mode) { await refreshStatus(); return; }
      let passphrase = passphraseInput.value;
      if (!passphrase || (mode === 'setup' && passphrase.length < 12)) {
        showError(mode === 'setup' ? 'Use at least 12 characters for your vault passphrase.' : 'Enter your vault passphrase.', passphraseInput);
        return;
      }
      if (mode === 'setup' && passphrase !== confirmInput.value) {
        showError('The passphrases do not match.', confirmInput);
        return;
      }
      const setup = mode === 'setup';
      setBusy(true);
      error.hidden = true;
      form.reset();
      let masterKey = null;
      try {
        if (setup) {
          // Recheck before creation: a previous POST may have saved despite a lost response.
          const status = await api('/api/vault');
          assertVaultGeneration(generation);
          if (status.exists) {
            configure(status);
            showError('A vault already exists. Unlock it with the passphrase used to create it.');
            return;
          }
          const created = await StackroomCrypto.createVault(passphrase);
          passphrase = '';
          assertVaultGeneration(generation);
          await api('/api/vault', { method: 'POST', body: JSON.stringify(created.vaultRecord) });
          assertVaultGeneration(generation);
          state.vault.exists = true;
          state.vault.record = created.vaultRecord;
          masterKey = created.masterKey;
        } else {
          masterKey = await StackroomCrypto.unlockVault(passphrase, state.vault.record);
          passphrase = '';
          assertVaultGeneration(generation);
        }
        state.vault.masterKey = masterKey;
        state.vault.unlocked = true;
        finish(true);
        refs.appShell.inert = false;
        refs.appShell.hidden = false;
        refs.avatarButton.focus();
        showToast(setup ? 'Private vault created.' : 'Private vault unlocked.');
      } catch (failure) {
        if (generation !== vaultGeneration || finished) return;
        if (setup && failure.status === 409) {
          await refreshStatus();
          if (generation !== vaultGeneration || finished) return;
          showError('A vault already exists. Unlock it with the passphrase used to create it.');
        } else {
          showError(setup ? 'Unable to create your vault. Check your connection and try again.'
            : failure.name === 'OperationError' ? 'Incorrect passphrase. Please try again.'
              : 'Unable to unlock this vault. Its encrypted metadata may be damaged or unsupported.');
        }
      } finally {
        passphrase = '';
        masterKey = null;
        if (generation === vaultGeneration && !finished) { setBusy(false); passphraseInput.focus(); }
      }
    };
    refreshStatus();
  });
}

async function lockVault() {
  if (!state.user) return;
  clearPrivateState();
  const generation = vaultGeneration;
  if (await initializeVault()) {
    await loadProjects();
    if (generation !== vaultGeneration) return;
    await loadGithubStatus();
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
    activities: Array.isArray(project.activities) ? project.activities : [],
    ...(project.legacy ? { legacy: {
      stack: String(project.legacy.stack || ''),
      domain: String(project.legacy.domain || ''),
      deployedUrl: String(project.legacy.deployedUrl || ''),
    } } : {}),
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
  const generation = vaultGeneration;
  if (!record?.isEncrypted) return record;
  if (!state.vault.masterKey) throw new Error('Private vault is locked.');
  if (!record.encryptedPayload) throw new Error('Encrypted project payload is missing.');

  const privateData = await StackroomCrypto.decryptJSON(
    state.vault.masterKey,
    record.encryptedPayload
  );

  assertVaultGeneration(generation);
  return hydrateEncryptedProject(record, privateData);
}

async function encryptedProjectRequest(project) {
  const generation = vaultGeneration;
  if (!state.vault.masterKey) throw new Error('Private vault is locked.');

  const encryptedPayload = await StackroomCrypto.encryptJSON(
    state.vault.masterKey,
    projectPrivateData(project)
  );

  assertVaultGeneration(generation);
  return {
    isEncrypted: true,
    encryptionVersion: encryptedPayload.version,
    encryptedPayload,
  };
}

function legacyMigrationSource(source) {
  const project = { ...source, ...projectPrivateData(source) };
  // Retain original v1 values and make resources visible when no richer equivalent exists.
  for (const name of (project.legacy?.stack || '').split(/[,+]/).map(value => value.trim()).filter(Boolean)) {
    if (!project.technologies.some(item => item.name === name)) {
      project.technologies = [...project.technologies, { name, kind: 'stack' }];
    }
  }
  const hostname = project.legacy?.domain?.trim();
  if (hostname && !project.domains.some(item => item.hostname === hostname)) {
    project.domains = [...project.domains, { hostname, autoRenew: false }];
  }
  const url = project.legacy?.deployedUrl?.trim();
  if (url && !project.deployments.some(item => item.url === url)) {
    project.deployments = [...project.deployments, { name: 'Production', url, environment: 'production', status: 'active' }];
  }
  return project;
}

async function migrateLegacyProjects() {
  if (!state.vault.unlocked || !state.vault.masterKey || state.migration?.running) return;
  const legacyProjects = state.projects.filter(project => !project.isEncrypted && project.id && !String(project.id).startsWith('local-'));
  if (!legacyProjects.length) {
    $('#migrationStatus').hidden = true;
    return;
  }

  const generation = vaultGeneration;
  const progress = { running: true, completed: 0, failed: 0, total: legacyProjects.length };
  state.migration = progress;
  $('#migrationStatus').hidden = false;
  $('#retryMigrationButton').hidden = true;
  try {
    for (const project of legacyProjects) {
      assertVaultGeneration(generation);
      $('#migrationMessage').textContent = `Encrypting older projects in your browser (${progress.completed + progress.failed + 1} of ${progress.total})…`;
      try {
        const path = `/api/projects/${encodeURIComponent(project.id)}/migrate`;
        // Fetch an authoritative, complete snapshot. A previous response may have been lost.
        const source = await api(path);
        let record = source;
        if (!source.isEncrypted) {
          if (!source.migrationRevision) throw new Error('Missing migration source revision.');
          const privateSource = legacyMigrationSource(source);
          const requestBody = await encryptedProjectRequest(privateSource);
          const verified = await StackroomCrypto.decryptJSON(state.vault.masterKey, requestBody.encryptedPayload);
          assertVaultGeneration(generation);
          if (JSON.stringify(verified) !== JSON.stringify(projectPrivateData(privateSource))) {
            throw new Error('Encrypted migration verification failed.');
          }
          record = await api(path, {
            method: 'POST',
            headers: { 'If-Match': source.migrationRevision },
            body: JSON.stringify(requestBody),
          });
        }
        if (!record.isEncrypted) throw new Error('Migration was not confirmed.');
        // Another tab may have migrated first; use its saved ciphertext, never stale local data.
        const migrated = await decryptProjectRecord(record);
        assertVaultGeneration(generation);
        const index = state.projects.findIndex(item => item.id === project.id);
        if (index >= 0) state.projects[index] = migrated;
        if (state.currentProject?.id === project.id) state.currentProject = migrated;
        progress.completed += 1;
      } catch (error) {
        if (error.name === 'AbortError' || generation !== vaultGeneration) return;
        // Keep this source available and continue the batch. Retry starts from a fresh snapshot.
        progress.failed += 1;
      }
    }
  } finally {
    if (generation === vaultGeneration) {
      progress.running = false;
      $('#migrationMessage').textContent = progress.failed
        ? `Could not confirm encryption for ${progress.failed} older ${progress.failed === 1 ? 'project' : 'projects'}. Retry to check saved data and continue.`
        : `${progress.completed} older ${progress.completed === 1 ? 'project is' : 'projects are'} now protected by your private vault.`;
      $('#retryMigrationButton').hidden = !progress.failed;
      renderDashboard();
      if (!refs.detailView.hidden && state.currentProject) renderDetail(state.currentProject);
      if (!refs.domainsView.hidden) renderDomainsPage();
      if (!refs.attentionView.hidden) renderAttentionPage();
    }
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
  const generation = vaultGeneration;
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
        if (!await initializeVault()) return;
        await loadProjects();
        assertVaultGeneration(generation);
        await loadGithubStatus();
        assertVaultGeneration(generation);
      } catch (error) {
        if (error.name === 'AbortError') return;
        if (generation !== vaultGeneration) return;
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
    if (error.name === 'AbortError') return;
    if (generation !== vaultGeneration) return;
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
  refs.authForm.reset();
  $('#retrySignOutButton').hidden = true;
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
    if (error.name === 'AbortError') return;
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
    if (error.name === 'AbortError') return;
    showAuthError(error.message);
  } finally {
    refs.googleButton.disabled = false;
  }
}

async function loadProjects() {
  const generation = vaultGeneration;
  if (!state.vault.unlocked) return;
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
        if (error.name === 'AbortError') return;
        if (generation !== vaultGeneration) return;
        console.error('Unable to decrypt project', record?.id, error);
        showToast('One encrypted project could not be decrypted.');
      }
    }

    assertVaultGeneration(generation);
    state.projects = projects;
    await migrateLegacyProjects();
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (generation !== vaultGeneration) return;
    state.projects = [];
    showToast(`Unable to load projects: ${error.message}`);
  }

  if (generation === vaultGeneration) renderDashboard();
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
  const activity = (project.activities || []).slice(0, 24).map(item => `<div class="activity-item"><div class="activity-dot"></div><div><strong>${escapeHTML(item.action)}</strong><p>${escapeHTML(item.detail || '')}</p></div><time>${relativeTime(item.createdAt)}</time></div>`).join('');
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
    if (error.name === 'AbortError') return;
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
  $('#refreshGithubButton')?.addEventListener('click', async () => {
    try {
      await loadGithubRepositories();
      showToast('GitHub repositories refreshed.');
    } catch (error) {
      if (error.name !== 'AbortError') showToast(error.message);
    }
  });
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
  } catch (error) {
    if (error.name === 'AbortError') return;
    showToast(error.message);
  }
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
  try {
    await loadGithubRepositories();
  } catch (error) {
    if (error.name === 'AbortError') return;
    refs.githubRepoList.innerHTML = `<div class="detail-empty">${escapeHTML(error.message)}</div>`;
  }
  setTimeout(() => { if (state.vault.unlocked && !refs.githubPickerBackdrop.hidden) refs.githubRepoSearch.focus(); }, 0);
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
  } catch (error) {
    if (error.name === 'AbortError') return;
    showToast(error.message);
  }
}

async function unlinkGithubRepository(project) {
  if (!window.confirm(`Unlink the GitHub repository from “${project.name}”?`)) return;
  try {
    await api(`/api/projects/${encodeURIComponent(project.id)}/github`, { method: 'DELETE' });
    const index = state.projects.findIndex(item => item.id === project.id);
    if (index >= 0) { state.projects[index] = { ...state.projects[index], github: null }; state.currentProject = state.projects[index]; }
    renderDetail(state.currentProject);
    showToast('GitHub repository unlinked.');
  } catch (error) {
    if (error.name === 'AbortError') return;
    showToast(error.message);
  }
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
  if (!state.vault.unlocked) return;
  if (project && !project.isEncrypted && !String(project.id).startsWith('local-')) {
    showToast('Finish migrating this project before editing it. Use Retry migration if needed.');
    return;
  }
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
  setTimeout(() => { if (state.vault.unlocked && !refs.modalBackdrop.hidden) refs.projectForm.elements.name.focus(); }, 0);
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
    if (state.currentProject.legacy) project.legacy = state.currentProject.legacy;
    project.activities = [
      { action: 'updated', detail: 'Project details updated.', createdAt: now },
      ...(state.currentProject.activities || []),
    ];
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
    if (error.name === 'AbortError') return;
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
    if (error.name === 'AbortError') return;
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
  if (!state.vault.unlocked) return;
  state.commandOpen = true;
  refs.commandBackdrop.hidden = false;
  refs.commandInput.value = '';
  renderCommandItems();
  setTimeout(() => { if (state.vault.unlocked && state.commandOpen) refs.commandInput.focus(); }, 0);
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
  // Clear locally before waiting for the network, even if server sign-out fails.
  clearPrivateState();
  state.user = null;
  refs.appShell.hidden = true;
  refs.authGate.hidden = false;
  refs.profileName.textContent = 'Signed in';
  refs.profileEmail.textContent = '\u2014';
  refs.avatarButton.textContent = 'S';
  setAuthMode('signin');
  $('#retrySignOutButton').hidden = true;
  refs.authSubmit.disabled = true;
  refs.googleButton.disabled = true;
  try {
    await api('/api/auth/sign-out', { method: 'POST', body: '{}' });
  } catch (error) {
    if (error.name !== 'AbortError') {
      showAuthError('Your vault is locked, but server sign-out failed. Check your connection and try again.');
      $('#retrySignOutButton').hidden = false;
    }
  } finally {
    refs.authSubmit.disabled = false;
    refs.googleButton.disabled = false;
  }
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
$('#privacyVaultSignOut').addEventListener('click', signOut);
$('#retrySignOutButton').addEventListener('click', async () => {
  $('#retrySignOutButton').hidden = true;
  await signOut();
});
$('#lockVaultButton').addEventListener('click', lockVault);
$('#retryMigrationButton').addEventListener('click', migrateLegacyProjects);

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
refs.githubRepoSearch.addEventListener('input', async () => {
  try {
    await loadGithubRepositories(refs.githubRepoSearch.value.trim());
  } catch (error) {
    if (error.name === 'AbortError') return;
    refs.githubRepoList.innerHTML = `<div class="detail-empty">${escapeHTML(error.message)}</div>`;
  }
});
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
  if (!$('#privacyVaultBackdrop').hidden) {
    if (event.key === 'Tab') {
      const controls = $$('input:not(:disabled), button:not(:disabled)', $('#privacyVaultForm'))
        .filter(control => control.getClientRects().length);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    return;
  }
  if (!state.vault.unlocked || refs.appShell.hidden) return;
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

// A restored back/forward-cache page must not restore an unlocked vault.
window.addEventListener('pagehide', clearPrivateState);
window.addEventListener('pageshow', event => { if (event.persisted) loadSession(); });

loadSession();
