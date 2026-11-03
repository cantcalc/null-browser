// GitHub expands absent Secrets to empty strings. Builder otherwise treats an
// empty CSC_LINK as the current directory, not as 'no signing certificate'.
for (const name of ['CSC_LINK','CSC_KEY_PASSWORD','WIN_CSC_LINK','CSC_INSTALLER_LINK','CSC_INSTALLER_KEY_PASSWORD','APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_TEAM_ID']) {
  if (process.env[name] === '') delete process.env[name];
}
