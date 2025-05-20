import { test, expect, Page, BrowserContext } from '@playwright/test';
import RHDHDeployment from '../../utils/authentication-providers/rhdh-deployment';
import { Common, setupBrowser } from '../../utils/common';
import { UIhelper } from '../../utils/ui-helper';

let page: Page;
let context: BrowserContext;

/* SUPORTED RESOLVERS
GITHUB:
    [x] usernameMatchingUserEntityName -> (Default)
    [x] emailMatchingUserEntityProfileEmail
    [x] emailLocalPartMatchingUserEntityName
*/

test.describe('Configure Github Provider', async () => {

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

    test('Login with Github emailMatchingUserEntityProfileEmail resolver', async () => {
        //A common sign-in resolver that looks up the user using the local part of their email address as the entity name.
        await deployment.setGithubResolver("emailMatchingUserEntityProfileEmail", false);
        await deployment.updateAllConfigs()
        await deployment.restartLocalDeployment();
        await page.waitForTimeout(3000)
        await deployment.waitForDeploymentReady();

        // wait for rhdh first sync and portal to be reachable
        await deployment.waitForSynced();

        const login = await common.githubLogin(
            "rhdhqeauth1",
            process.env.AUTH_PROVIDERS_GH_USER_PASSWORD,
            process.env.AUTH_PROVIDERS_GH_USER_2FA,
        );
        expect(login).toBe("Login successful");

        await uiHelper.verifyAlertErrorMessage(/Login failed; caused by Error: Failed to sign-in, unable to resolve user identity. Please verify that your catalog contains the expected User entities that would match your configured sign-in resolver. For non-production environments, manually provision the user or disable the user provisioning requirement by setting the `dangerouslyAllowSignInWithoutUserInCatalog` option./);
        await context.clearCookies();
    });

    test('Login with Github emailLocalPartMatchingUserEntityName resolver', async () => {
        //A common sign-in resolver that looks up the user using the local part of their email address as the entity name.
        await deployment.setGithubResolver("emailLocalPartMatchingUserEntityName", false);
        await deployment.updateAllConfigs()
        await deployment.restartLocalDeployment();
        await page.waitForTimeout(3000)
        await deployment.waitForDeploymentReady();

        // wait for rhdh first sync and portal to be reachable
        await deployment.waitForSynced();

        const login = await common.githubLogin(
            "rhdhqeauth1",
            process.env.AUTH_PROVIDERS_GH_USER_PASSWORD,
            process.env.AUTH_PROVIDERS_GH_USER_2FA,
        );

        // Login failed; caused by Error: Login failed, user profile does not contain an email

        expect(login).toBe("Login successful");

        await uiHelper.verifyAlertErrorMessage(/Login failed; caused by Error: Failed to sign-in, unable to resolve user identity. Please verify that your catalog contains the expected User entities that would match your configured sign-in resolver. For non-production environments, manually provision the user or disable the user provisioning requirement by setting the `dangerouslyAllowSignInWithoutUserInCatalog` option./);
        await context.clearCookies();
    });

    test(`Set Github sessionDuration and confirm in auth cookie duration has been set`, async () => {
        deployment.setAppConfigProperty('auth.providers.github.production.sessionDuration', '3days')
        await deployment.updateAllConfigs()
        await deployment.restartLocalDeployment();
        await page.waitForTimeout(3000)
        await deployment.waitForDeploymentReady();

        // wait for rhdh first sync and portal to be reachable
        await deployment.waitForSynced();

        const login = await common.githubLogin(
            "rhdhqeauthadmin",
            process.env.AUTH_PROVIDERS_GH_USER_PASSWORD,
            process.env.AUTH_PROVIDERS_GH_ADMIN_2FA,
        );
        expect(login).toBe("Login successful");
    
        await page.reload();

        const cookies = await context.cookies();
        const authCookie = cookies.find(
        (cookie) => cookie.name === "github-refresh-token",
        );

        const threeDays = 3 * 24 * 60 * 60 * 1000; // expected duration of 3 days in ms
        const tolerance = 3 * 60 * 1000; // allow for 3 minutes tolerance

        const actualDuration = authCookie.expires * 1000 - Date.now();

        expect(actualDuration).toBeGreaterThan(threeDays - tolerance);
        expect(actualDuration).toBeLessThan(threeDays + tolerance);

        await page.goto("/settings");
        await uiHelper.verifyHeading("RHDH QE Admin");
        await common.signOut();
        await context.clearCookies();
    });
    
    test(`Ingestion of Github users and groups: verify the user entities and groups are created with the correct relationships`, async () => {
        test.setTimeout(300 * 1000);
        await page.waitForTimeout(5000)

        expect(await deployment.checkUserIsIngestedInCatalog(["RHDH QE User 1", "RHDH QE Admin"])).toBe(true);
        expect(await deployment.checkGroupIsIngestedInCatalog(["test_admins", "test_all", "test_users"])).toBe(true);
        expect(await deployment.checkUserIsInGroup('rhdhqeauthadmin', 'test_admins')).toBe(true);
        expect(await deployment.checkUserIsInGroup('rhdhqeauth1', 'test_users')).toBe(true);

        expect(await deployment.checkGroupIsChildOfGroup('test_users', 'test_all')).toBe(true);
        expect(await deployment.checkGroupIsChildOfGroup('test_admins', 'test_all')).toBe(true);

        
    });

    test.afterAll(async () => {
        console.log("Cleaning up...");
        await deployment.killRunningProcess();
    });
});