const { exec } = require("child_process");
const { promisify } = require("util");

const execAsync = promisify(exec);

/**
 * Cloud Function to automatically label GKE clusters when they are created
 *
 * @param {Object} event - The EventArc event data
 * @param {Object} context - The EventArc context
 */
exports.labelCluster = async (event, context) => {
  try {
    console.log("Received event:", JSON.stringify(event, null, 2));

    // Parse the event data
    let eventData;
    try {
      if (event.data) {
        const decodedData = Buffer.from(event.data, "base64").toString();
        eventData = JSON.parse(decodedData);
      } else {
        eventData = event;
      }
    } catch (parseError) {
      console.error("Failed to parse event data:", parseError.message);
      return;
    }

    // Extract cluster information from the audit log
    const protoPayload = eventData.protoPayload;
    if (!protoPayload || !protoPayload.resourceName) {
      console.error("Missing protoPayload or resourceName in event data");
      return;
    }

    // Extract cluster name from resource name (format: projects/PROJECT/zones/ZONE/clusters/CLUSTER_NAME)
    const resourceParts = protoPayload.resourceName.split("/");
    const clusterName = resourceParts[resourceParts.length - 1];

    // Extract location (can be zone or region)
    const resource = eventData.resource;
    const location = resource?.labels?.location || resource?.labels?.zone;

    if (!clusterName || !location) {
      console.error(
        "Unable to extract cluster name or location from event data",
      );
      console.error("Cluster name:", clusterName);
      console.error("Location:", location);
      return;
    }

    console.log(
      `Detected new cluster creation: ${clusterName} in location ${location}`,
    );

    // Define the labels to apply
    const labels = {
      "app-code": "rhdh-003",
      "service-phase": "dev",
      "cost-center": "726",
    };

    // Convert labels to the format expected by gcloud
    const labelString = Object.entries(labels)
      .map(([key, value]) => `${key}=${value}`)
      .join(",");

    // Determine if it's a zone or region
    const locationFlag =
      location.includes("-") && location.split("-").length === 3
        ? "--zone"
        : "--region";

    const command = `gcloud container clusters update ${clusterName} ${locationFlag} ${location} --update-labels ${labelString}`;

    console.log(`Executing command: ${command}`);

    // Execute the gcloud command
    const { stdout, stderr } = await execAsync(command);

    if (stderr && !stderr.includes("Updated")) {
      console.warn(`Command stderr: ${stderr}`);
    }

    console.log(`Labels applied successfully to cluster ${clusterName}`);
    console.log(`Command output: ${stdout}`);

    return { success: true, cluster: clusterName, location };
  } catch (error) {
    console.error(`Failed to apply labels: ${error.message}`);
    console.error("Error details:", error);

    // Return error information for debugging
    return {
      success: false,
      error: error.message,
      stack: error.stack,
    };
  }
};
