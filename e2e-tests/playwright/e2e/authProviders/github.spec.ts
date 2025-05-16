import { test, expect, Page, BrowserContext } from '@playwright/test';
import RHDHDeployment from '../../utils/authentication-providers/rhdh-deployment';
import { Common, setupBrowser } from '../../utils/common';
import { UIhelper } from '../../utils/ui-helper';

let page: Page;
let context: BrowserContext;

/* SUPORTED RESOLVERS
OIDC:
    ❗Changed from 1.5
    [x] oidcSubClaimMatchingIdPUserId -> (Default, no setting specified)
    [x] oidcSubClaimMatchingKeycloakUserId -> (same as above, but need to be set explicitely in the config)
    [x] preferredUsernameMatchingUserEntityName (patched)
    [x] emailLocalPartMatchingUserEntityName
    [x] emailMatchingUserEntityProfileEmail -> email will always match, just making sure it logs in
    [-] oidcSubClaimMatchingPingIdentityUserId -> Ping Identity not supported

MICOROSFT:
    [x] userIdMatchingUserEntityAnnotation -> (Default)
    [x] emailMatchingUserEntityAnnotation
    [x] emailMatchingUserEntityProfileEmail -> email will always match, just making sure it logs in
    [-] emailLocalPartMatchingUserEntityName

GITHUB:
    [] usernameMatchingUserEntityName -> (Default)
    [] emailMatchingUserEntityProfileEmail
    [] emailLocalPartMatchingUserEntityName

LDAP:

*/

test.describe('Configure Microsoft Provider', async () => {

    let common: Common;
    let uiHelper: UIhelper;

    const namespace = 'albarbaro-test-namespace-github';
    const appConfigMap = 'app-config-rhdh';
    const rbacConfigMap = 'rbac-policy';
    const dynamicPluginsConfigMap = 'dynamic-plugins';
    const secretName = 'rhdh-secrets';
    
    // set deployment instance
    const deployment: RHDHDeployment = new RHDHDeployment(namespace, appConfigMap, rbacConfigMap, dynamicPluginsConfigMap, secretName);
    deployment.instanceName = 'rhdh'

    // compute backstage baseurl
    const backstageUrl = await deployment.computeBackstageUrl();
    const backstageBackendUrl = await deployment.computeBackstageBackendUrl();
    console.log(`Backstage BaseURL is: ${backstageUrl}`);

    test.use({baseURL: backstageUrl});

    test.beforeAll(async ({ browser }, testInfo) => {
        test.info().setTimeout(600*1000);
        // load default configs from yaml files
        await deployment.loadAllConfigs();

        // setup playwright helpers
        ({ context, page } = await setupBrowser(browser, testInfo));
        common = new Common(page);
        uiHelper = new UIhelper(page);

        // expect some expected variables
        
        expect(process.env.AUTH_PROVIDERS_GH_ORG_NAME).toBeDefined();
        expect(process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET).toBeDefined();
        expect(process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_ID).toBeDefined();
        expect(process.env.AUTH_PROVIDERS_GH_USER_PASSWORD).toBeDefined();
        expect(process.env.AUTH_PROVIDERS_GH_USER_2FA).toBeDefined();
        expect(process.env.AUTH_PROVIDERS_GH_ADMIN_2FA).toBeDefined();
        expect(process.env.AUTH_PROVIDERS_GH_ORG_APP_ID).toBeDefined();
        expect(process.env.AUTH_PROVIDERS_GH_ORG1_PRIVATE_KEY).toBeDefined();
        expect(process.env.AUTH_PROVIDERS_GH_ORG_WEBHOOK_SECRET).toBeDefined();

        // clean old namespaces
        await deployment.deleteNamespaceIfExists();

        // create namespace and wait for it to be active
        (await deployment.createNamespace()).waitForNamespaceActive();

        // create all base configmaps 
        await deployment.createAllConfigs();

        // generate static token
        await deployment.generateStaticToken();

        // set enviroment variables and create secret
        if(!process.env.ISRUNNINGLOCAL) deployment.addSecretData("BASE_URL", backstageUrl);
        if(!process.env.ISRUNNINGLOCAL) deployment.addSecretData("BASE_BACKEND_URL", backstageBackendUrl);
        deployment.addSecretData("AUTH_PROVIDERS_GH_ORG_NAME", process.env.AUTH_PROVIDERS_GH_ORG_NAME);
        deployment.addSecretData("AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET", process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_SECRET);
        deployment.addSecretData("AUTH_PROVIDERS_GH_ORG_CLIENT_ID", process.env.AUTH_PROVIDERS_GH_ORG_CLIENT_ID);
        deployment.addSecretData("AUTH_PROVIDERS_GH_ORG_APP_ID", process.env.AUTH_PROVIDERS_GH_ORG_APP_ID);
        deployment.addSecretData("AUTH_PROVIDERS_GH_ORG1_PRIVATE_KEY", process.env.AUTH_PROVIDERS_GH_ORG1_PRIVATE_KEY);
        deployment.addSecretData("AUTH_PROVIDERS_GH_ORG_WEBHOOK_SECRET", process.env.AUTH_PROVIDERS_GH_ORG_WEBHOOK_SECRET);

        await deployment.createSecret();

        // enable keycloak login with ingestion
        await deployment.enableGithubLoginWithIngestion()
        await deployment.updateAllConfigs();

        // create backstage deployment and wait for it to be ready
        await deployment.createBackstageDeployment();
        await deployment.waitForDeploymentReady();
        
        // wait for rhdh first sync and portal to be reachable
        await deployment.waitForSynced();
    });

    test.beforeEach(async () => {
        test.info().setTimeout(600*1000);
        console.log(`Running test case ${test.info().title} - Attempt #${test.info().retry}`)
    });

    test('Login with Github default resolver', async () => {
        
        const login = await common.githubLogin(
            "rhdhqeauthadmin",
            process.env.AUTH_PROVIDERS_GH_USER_PASSWORD,
            process.env.AUTH_PROVIDERS_GH_ADMIN_2FA,
        );
        expect(login).toBe("Login successful");

        await page.goto("/settings");
        await uiHelper.verifyHeading("RHDH QE Admin");
        await common.signOut();
        await context.clearCookies();
    });
    

    test.afterAll(async () => {
        console.log("Cleaning up...");
        await deployment.killRunningProcess();
    });
});