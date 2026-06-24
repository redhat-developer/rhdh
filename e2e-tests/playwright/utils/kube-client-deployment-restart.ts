import { getKubeApiErrorMessage, sleep } from "./kube-client-helpers";

async function scaleDeploymentDown(
  scaleDeployment: (deploymentName: string, namespace: string, replicas: number) => Promise<void>,
  waitForDeploymentReady: (
    deploymentName: string,
    namespace: string,
    expectedReplicas: number,
    timeout?: number,
  ) => Promise<void>,
  logPodConditionsForDeployment: (deploymentName: string, namespace: string) => Promise<void>,
  deploymentName: string,
  namespace: string,
): Promise<void> {
  console.log(`Scaling down deployment ${deploymentName} to 0 replicas.`);
  console.log(`Deployment: ${deploymentName}, Namespace: ${namespace}`);
  await logPodConditionsForDeployment(deploymentName, namespace);
  await scaleDeployment(deploymentName, namespace, 0);
  await waitForDeploymentReady(deploymentName, namespace, 0, 300000);
  console.log("Waiting for pods to be fully terminated...");
  await sleep(10000);
}

async function scaleDeploymentUp(
  scaleDeployment: (deploymentName: string, namespace: string, replicas: number) => Promise<void>,
  waitForDeploymentReady: (
    deploymentName: string,
    namespace: string,
    expectedReplicas: number,
    timeout?: number,
  ) => Promise<void>,
  deploymentName: string,
  namespace: string,
): Promise<void> {
  console.log(`Scaling up deployment ${deploymentName} to 1 replica.`);
  await scaleDeployment(deploymentName, namespace, 1);
  await waitForDeploymentReady(deploymentName, namespace, 1, 600000);
}

export async function restartDeploymentImpl(
  scaleDeployment: (deploymentName: string, namespace: string, replicas: number) => Promise<void>,
  waitForDeploymentReady: (
    deploymentName: string,
    namespace: string,
    expectedReplicas: number,
    timeout?: number,
  ) => Promise<void>,
  logPodConditionsForDeployment: (deploymentName: string, namespace: string) => Promise<void>,
  logDeploymentEvents: (deploymentName: string, namespace: string) => Promise<void>,
  deploymentName: string,
  namespace: string,
): Promise<void> {
  try {
    console.log(`Starting deployment restart for ${deploymentName} in namespace ${namespace}`);
    await scaleDeploymentDown(
      scaleDeployment,
      waitForDeploymentReady,
      logPodConditionsForDeployment,
      deploymentName,
      namespace,
    );
    await scaleDeploymentUp(scaleDeployment, waitForDeploymentReady, deploymentName, namespace);
    console.log(`Restart of deployment ${deploymentName} completed successfully.`);
  } catch (error) {
    console.error(
      `Error during deployment restart: Deployment '${deploymentName}' in namespace '${namespace}': ${getKubeApiErrorMessage(error)}`,
    );
    await logPodConditionsForDeployment(deploymentName, namespace);
    await logDeploymentEvents(deploymentName, namespace);
    throw new Error(
      `Failed to restart deployment '${deploymentName}' in namespace '${namespace}': ${getKubeApiErrorMessage(error)}`,
      { cause: error },
    );
  }
}
