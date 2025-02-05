import { runShellCmd } from "../../utils/helper";
import fs from "fs";
import { LOGGER } from "../../utils/logger";

export class OperatorScript {
  readonly operatorProjectPath = `${process.cwd()}/e2e-tests/operator-project`;
  readonly scriptPath = `${this.operatorProjectPath}/.rhdh/scripts/install-rhdh-catalog-source.sh`;
  readonly operatorRepo =
    "https://github.com/redhat-developer/rhdh-operator.git";
  rhdhUrl: string;
  catalogUrl: string;

  private constructor() {}
  public static async build(
    namespace = "default",
    server = process.env.K8S_CLUSTER_URL,
    user = "ci-user",
    token = process.env.K8S_CLUSTER_TOKEN,
  ) {
    const instance = new OperatorScript();

    if (!fs.existsSync(instance.operatorProjectPath))
      await runShellCmd(
        `git clone ${instance.operatorRepo} ${instance.operatorProjectPath}`,
      );

    await runShellCmd(
      `kubectl config set-cluster my-openshift-cluster \
      --server=${server} \
      --insecure-skip-tls-verify=true`,
    );
    await runShellCmd(
      `kubectl config set-credentials ${user} --token=${token}`,
    );
    await runShellCmd(
      `kubectl config set-context default-context \
       --cluster=my-openshift-cluster \
       --user=${user} \
       --namespace=${namespace}`,
    );
    await runShellCmd(`kubectl config use-context default-context`);
    return instance;
  }

  getDeploymentYamlPath(): string {
    return "/Users/ngallego/Documents/_repos/backstage-showcase/e2e-tests/playwright/data/backstage-operator.yaml";
  }

  async installBackstageCRD(namespace = "default") {
    const command = `oc get crd/backstages.rhdh.redhat.com -n rhdh-operator`;
    console.log(namespace);

    await runShellCmd(command)
      .then(async (e) => {
        console.log(e);
        await new Promise((resolve) => setTimeout(resolve, 30_000));
      })
      .catch((e) => {
        throw new Error(`Error during Backstage CRD installation: ${e}`);
      });
  }

  // https://github.com/redhat-developer/rhdh-operator/blob/main/.rhdh/scripts/install-rhdh-catalog-source.sh
  async run(options: string[], namespace = "rhdh-operator") {
    console.log(namespace);
    try {
      const result = await runShellCmd(
        `${this.scriptPath} ${options.join(" ")}`,
      );
      const message = result + "";
      LOGGER.info(message);
      console.log(message);
      const lines = message.trim().split("\n");
      const url = lines[lines.length - 1];

      this.catalogUrl = lines.find((e) =>
        e.includes("catalog/ns/rhdh-operator"),
      );

      if (url.includes("https")) {
        console.log("Extracted URL:", url);
        this.rhdhUrl = url;
      } else {
        console.log("URL not found");
      }
    } catch (e) {
      LOGGER.error(e);
      throw Error(e);
    }

    await new Promise((resolve) => setTimeout(resolve, 30_000));

    try {
      const result = await runShellCmd(
        `oc apply -f ${this.getDeploymentYamlPath()}`,
      );
      const message = result + "";
      LOGGER.info(message);
      console.log(message);
    } catch (e) {
      LOGGER.error(e);
      throw Error(e);
    }
  }
}
