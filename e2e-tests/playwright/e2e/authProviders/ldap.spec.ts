import { test, expect, Page, BrowserContext } from '@playwright/test';
import RHDHDeployment from '../../utils/authentication-providers/rhdh-deployment';
import { Common, setupBrowser } from '../../utils/common';
import { UIhelper } from '../../utils/ui-helper';
import { MSGraphClient } from '../../utils/authentication-providers/msgraph-helper'

let page: Page;
let context: BrowserContext;

/* SUPORTED RESOLVERS
LDAP:
    [] -> (Default)
*/

test.describe('Configure LDAP Provider', async () => {

    let common: Common;
    let uiHelper: UIhelper;

    const namespace = 'albarbaro-test-namespace-ldap';
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
        // TODO UPDATE envs
        expect(process.env.DEFAULT_USER_PASSWORD_2).toBeDefined();

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
        // TODO UPDATE envs
        deployment.addSecretData("DEFAULT_USER_PASSWORD", process.env.DEFAULT_USER_PASSWORD);

        await deployment.createSecret();

        // enable keycloak login with ingestion
        // TODO -> await deployment.enableMicrosoftLoginWithIngestion()
        await deployment.updateAllConfigs();

        // update the Azure App Registration to include the current redirectUrl
        const graphClient = new MSGraphClient(process.env.AUTH_PROVIDERS_AZURE_CLIENT_ID, process.env.AUTH_PROVIDERS_AZURE_CLIENT_SECRET, process.env.AUTH_PROVIDERS_AZURE_TENANT_ID);
        await graphClient.addAppRedirectUrlsAsync([`${backstageUrl}/api/auth/microsoft/handler/frame`]);
        // TODO -> update NSG rules for public IP

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

    test('Login with LDAP default resolver', async () => {

    });

    test('Login with LDAP emailMatchingUserEntityAnnotation resolver', async () => {
        
    });

    test(`Set LDAP sessionDuration and confirm in auth cookie duration has been set`, async () => {
        
    });

    test(`Ingestion of LDAP users and groups: verify the user entities and groups are created with the correct relationships`, async () => {

        
    });

    test.afterAll(async () => {
        console.log("Cleaning up...");
        await deployment.killRunningProcess();
        const graphClient = new MSGraphClient(process.env.AUTH_PROVIDERS_AZURE_CLIENT_ID, process.env.AUTH_PROVIDERS_AZURE_CLIENT_SECRET, process.env.AUTH_PROVIDERS_AZURE_TENANT_ID);
        await graphClient.removeAppRedirectUrlsAsync([`${backstageUrl}/api/auth/microsoft/handler/frame`]);
        // TODO -> clear NSG rule
    });
});