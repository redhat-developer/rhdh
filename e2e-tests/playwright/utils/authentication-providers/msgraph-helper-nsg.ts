import {
  NetworkManagementClient,
  NetworkSecurityGroupsGetResponse,
  SecurityRule,
  SecurityRulesGetResponse,
} from "@azure/arm-network";

import { getErrorMessage, hasStatusCode } from "../errors";

export async function getNetworkSecurityGroupRule(
  armNetworkClient: NetworkManagementClient,
  resourceGroupName: string,
  nsgName: string,
  ruleName: string,
): Promise<SecurityRulesGetResponse | null> {
  try {
    console.log(
      `Getting network security group rule ${ruleName} from NSG ${nsgName} in resource group ${resourceGroupName}`,
    );

    const rule = await armNetworkClient.securityRules.get(resourceGroupName, nsgName, ruleName);
    return rule ?? null;
  } catch (e) {
    if (hasStatusCode(e) && e.statusCode === 404) {
      console.log(`Network security group rule ${ruleName} not found in NSG ${nsgName}`);
      return null;
    }
    console.error("Failed to get network security group rule:", e);
    throw e;
  }
}

export async function getNetworkSecurityGroup(
  armNetworkClient: NetworkManagementClient,
  resourceGroupName: string,
  nsgName: string,
): Promise<NetworkSecurityGroupsGetResponse> {
  try {
    console.log(
      `Getting network security group ${nsgName} from resource group ${resourceGroupName}`,
    );

    const nsg = await armNetworkClient.networkSecurityGroups.get(resourceGroupName, nsgName);
    if (nsg === undefined) {
      throw new Error(`Network security group ${nsgName} not found in ${resourceGroupName}`);
    }
    return nsg;
  } catch (e) {
    console.error("Failed to get network security group:", e);
    throw e;
  }
}

async function findAvailablePriority(
  armNetworkClient: NetworkManagementClient,
  resourceGroupName: string,
  nsgName: string,
): Promise<number> {
  const existingRules = armNetworkClient.securityRules.list(resourceGroupName, nsgName);
  const existingPriorities = new Set<number>();

  for await (const rule of existingRules) {
    if (rule.priority !== undefined) {
      existingPriorities.add(rule.priority);
    }
  }

  let availablePriority = 200;
  while (existingPriorities.has(availablePriority)) {
    availablePriority++;
  }
  return availablePriority;
}

function buildTemporaryNsgRule(
  templateRule: SecurityRulesGetResponse,
  availablePriority: number,
): SecurityRule {
  return {
    protocol: templateRule.protocol,
    sourcePortRange: templateRule.sourcePortRange,
    destinationPortRange: templateRule.destinationPortRange,
    sourceAddressPrefix: "*",
    destinationAddressPrefix: templateRule.destinationAddressPrefix,
    access: templateRule.access,
    priority: availablePriority,
    direction: templateRule.direction,
    description: `Temporary E2E test rule allowing all IPs - Created at ${new Date().toISOString()}`,
  };
}

function createNsgRuleCleanup(
  armNetworkClient: NetworkManagementClient,
  resourceGroupName: string,
  nsgName: string,
  ruleName: string,
): () => Promise<void> {
  return async (): Promise<void> => {
    try {
      console.log(`[NSG] Starting cleanup for rule: ${ruleName}`);
      console.log(`[NSG] Verifying rule exists before deletion...`);

      const existingRule = await getNetworkSecurityGroupRule(
        armNetworkClient,
        resourceGroupName,
        nsgName,
        ruleName,
      );
      if (existingRule === null) {
        console.log(
          `[NSG] Rule ${ruleName} not found during cleanup - may have been already deleted`,
        );
        return;
      }

      console.log(`[NSG] Deleting rule: ${ruleName}`);
      const deletePoller = await armNetworkClient.securityRules.beginDelete(
        resourceGroupName,
        nsgName,
        ruleName,
      );
      console.log(`[NSG] Waiting for rule deletion to complete...`);
      await deletePoller.pollUntilDone();
      console.log(`[NSG] Rule deleted successfully: ${ruleName}`);
    } catch (error) {
      console.error(`[NSG] Failed to cleanup rule ${ruleName}:`, error);
      console.error(`[NSG] Cleanup error details:`, {
        message: getErrorMessage(error),
        statusCode: hasStatusCode(error) ? error.statusCode : undefined,
      });
    }
  };
}

function generateRuleName(baseRuleName: string): string {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `${baseRuleName}-${timestamp}-${randomSuffix}`;
}

function logNsgFailure(error: unknown): void {
  console.error(`[NSG] Failed to allow public IP in NSG:`, error);
  console.error(`[NSG] Error details:`, {
    message: getErrorMessage(error),
    statusCode: hasStatusCode(error) ? error.statusCode : undefined,
  });
}

async function resolveTemplateRule(
  armNetworkClient: NetworkManagementClient,
  resourceGroupName: string,
  nsgName: string,
  baseRuleName: string,
): Promise<SecurityRulesGetResponse> {
  console.log(`[NSG] Verifying NSG exists: ${nsgName} in resource group: ${resourceGroupName}`);
  const nsg = await getNetworkSecurityGroup(armNetworkClient, resourceGroupName, nsgName);
  console.log(`[NSG] NSG verified: ${nsg.name} (ID: ${nsg.id})`);

  console.log(`[NSG] Getting existing rule as template: ${baseRuleName}`);
  const templateRule = await getNetworkSecurityGroupRule(
    armNetworkClient,
    resourceGroupName,
    nsgName,
    baseRuleName,
  );

  if (templateRule === null) {
    throw new Error(`Template rule ${baseRuleName} not found in NSG ${nsgName}`);
  }
  console.log(
    `[NSG] Template rule found: ${templateRule.name} (Priority: ${templateRule.priority})`,
  );
  return templateRule;
}

async function createTemporaryNsgRule(
  armNetworkClient: NetworkManagementClient,
  resourceGroupName: string,
  nsgName: string,
  ruleName: string,
  templateRule: SecurityRulesGetResponse,
): Promise<void> {
  const availablePriority = await findAvailablePriority(
    armNetworkClient,
    resourceGroupName,
    nsgName,
  );
  console.log(
    `[NSG] Template rule priority: ${templateRule.priority}, Using available priority: ${availablePriority}`,
  );

  const newRule = buildTemporaryNsgRule(templateRule, availablePriority);

  console.log(`[NSG] Creating new rule: ${ruleName} with wildcard IP (*)`);
  console.log(
    `[NSG] Rule details: Priority=${newRule.priority}, Protocol=${newRule.protocol}, Access=${newRule.access}`,
  );

  const rulePoller = await armNetworkClient.securityRules.beginCreateOrUpdate(
    resourceGroupName,
    nsgName,
    ruleName,
    newRule,
  );

  console.log(`[NSG] Waiting for rule creation to complete...`);
  const createdRule = await rulePoller.pollUntilDone();

  console.log(`[NSG] Rule created successfully: ${ruleName}`);
  console.log(`[NSG] Rule ID: ${createdRule.id}`);
}

export async function allowPublicIpInNsg(
  armNetworkClient: NetworkManagementClient,
  getPublicIp: () => Promise<string>,
  resourceGroupName: string,
  nsgName: string,
  baseRuleName: string = "AllowE2EJobs",
): Promise<{
  publicIp: string;
  ruleName: string;
  resourceGroupName: string;
  nsgName: string;
  cleanup: () => Promise<void>;
}> {
  try {
    console.log("[NSG] Getting current public IP address...");
    const publicIp = await getPublicIp();
    console.log(`[NSG] Public IP obtained: ${publicIp}`);

    const ruleName = generateRuleName(baseRuleName);
    console.log(`[NSG] Generated unique rule name: ${ruleName}`);

    const templateRule = await resolveTemplateRule(
      armNetworkClient,
      resourceGroupName,
      nsgName,
      baseRuleName,
    );
    await createTemporaryNsgRule(
      armNetworkClient,
      resourceGroupName,
      nsgName,
      ruleName,
      templateRule,
    );

    return {
      publicIp,
      ruleName,
      resourceGroupName,
      nsgName,
      cleanup: createNsgRuleCleanup(armNetworkClient, resourceGroupName, nsgName, ruleName),
    };
  } catch (error) {
    logNsgFailure(error);
    throw error;
  }
}
