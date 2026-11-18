/* Boot for a claude.ai artifact: capabilities `sample` and `downloads` must be declared on the artifact. */
if (window.claude && claude.use) {
  claude.use('sample').then(x => { sample = x; render(); }).catch(() => {});
  claude.use('downloads').then(x => { downloads = x; if (tab === 'export') render(); }).catch(() => {});
}
