// Assisted by watsonx Code Assistant 

import { writeFile } from 'fs/promises';

// Check for output file argument
const outputFilePath = process.argv[2];
if (!outputFilePath) {
  console.error('Please provide an output file path as an argument.');
  console.error(`Usage: node ${process.argv[1]} <output-file-path>`);
  process.exit(1);
}

const repository = process.env.GITHUB_REPOSITORY || 'redhat-developer/rhdh';

// old branches
const skipBranches = [
  "release-0.1",
  "release-0.2",
  "release-1.0",
]

const backstageJsonPath = 'backstage.json';
const frontendPackageJsonPath = 'packages/app/package.json';
const backendPackageJsonPath = 'packages/backend/package.json';

// Frontend and Backend packages to be documented
const frontendPackages = [
  '@backstage/catalog-model',
  '@backstage/config',
  '@backstage/core-app-api',
  '@backstage/core-components',
  '@backstage/core-plugin-api',
  '@backstage/integration-react'
];

const backendPackages = [
  '@backstage/backend-app-api',
  '@backstage/backend-defaults',
  '@backstage/backend-dynamic-feature-service',
  '@backstage/backend-plugin-api',
  '@backstage/catalog-model',
  '@backstage/cli-node',
  '@backstage/config',
  '@backstage/config-loader'
];

// List all branches in the repository
// uses fetch and no github library to avoid depencies on extra libraries
async function listBranchNames(repository, page = 1, collected = []) {
  const url = `https://api.github.com/repos/${repository}/branches?page=${page}`;

  const headers = {
    'Accept': 'application/vnd.github.v3+json'
  }
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
  } else {
    console.info('WARNING: GITHUB_TOKEN is not set. Using unauthenticated requests may result in rate limiting.');
  }
  try {
    const response = await fetch(url, {
      headers: headers
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.error(`Repository ${repository} not found.`);
      } else {
        console.error(`Error listing branches:`, response.statusText);
      }
      return [];
    }

    const data = await response.json();
    const branchNames = data.map(branch => branch.name);
    const allNames = [...collected, ...branchNames];

    const links = response.headers.get('Link');
    const hasNext = links && links.includes('rel="next"');

    if (hasNext) {
      return listBranchNames(repository, page + 1, allNames);
    } else {
      return allNames;
    }

  } catch (error) {
    console.error(`Error listing branches:`, error.message);
    return [];
  }
}

// return the content of the file
async function getFileFromGithub(repository, branch, filePath) {
  const url = `https://raw.githubusercontent.com/${repository}/${branch}/${filePath}`;
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`File ${filePath} not found in branch ${branch}.`);
      } else {
        console.error(`Error fetching file:`, response.statusText);
      }
      return null;
    }

    const data = await response.text();
    return data;

  } catch (error) {
    console.error(`Error fetching file:`, error.message);
    return null;
  }

}


// generate the table for the packages and versions based on the provided package.json
// only packages in the packageNames array will be included
async function generateTable(packageJson, packageNames) {
  let table = `
| **Package**                    | **Version** |
| ------------------------------ | ----------- |
`
  for (const pkg of packageNames) {
    const version = packageJson.dependencies[pkg]
    if (!version) {
      console.warn(`Unable to find ${pkg} in packageNames`)
    }
    table += `| \`${pkg}\` | \`${version}\` |\n`
  }

  return table;
}

// Function to write content to file
async function writeToFile(filePath, content) {
  try {
    await writeFile(filePath, content);
    console.log(`Successfully wrote output to ${filePath}`);
  } catch (error) {
    console.error(`Error writing to file: ${error.message}`);
  }
}

async function main() {

  const allBranches = await listBranchNames(repository);

  // only release branches and not in skipBranches
  const releaseBranches = allBranches
    .filter((branch) => branch.startsWith('release-'))
    .filter((branch) => !skipBranches.includes(branch))


  // sort the branches by the number after release- in descending order
  releaseBranches.sort((a, b) => {
    const aNum = parseFloat(a.split('-')[1]);
    const bNum = parseFloat(b.split('-')[1]);
    return bNum - aNum;
  });

  // limit to 4 latest branches
  if (releaseBranches.length > 4) {
    releaseBranches.length = 4;
  }
  
  // add main branch as first in the list as we want to document version for pre-release
  releaseBranches.unshift("main")

  console.log(`Release branches found: ${releaseBranches.join(", ")}`);

  // Collect all outputs
  let allOutputs = '';

  for (const branch of releaseBranches) {
    console.log(`Processing branch ${branch}`)

    let release = ""
    if (branch === "main") {
      release = "next"
    } else {
      release = branch.split('-')[1];
    }
    console.log(`Release: ${release}`)

    const backstageJson = await getFileFromGithub(repository, branch, backstageJsonPath);
    const backstageVersion = JSON.parse(backstageJson).version

    if (!backstageVersion) {
      console.error(`Unable to find backstage version in ${backstageJson}`);
      process.exit(1);
    }

    const minorBackstageVersion = backstageVersion.split('.').slice(0, 2).join('.')

    const frontendPackageJson = await getFileFromGithub(repository, branch, frontendPackageJsonPath);
    const backendPackageJson = await getFileFromGithub(repository, branch, backendPackageJsonPath);

    const frontendTable = await generateTable(JSON.parse(frontendPackageJson), frontendPackages)
    const backendTable = await generateTable(JSON.parse(backendPackageJson), backendPackages)

    const preRelaseInfo = `(pre-release, versions can change for final release)`

    const createAppPackageJson = await getFileFromGithub("backstage/backstage", `v${backstageVersion}`, 'packages/create-app/package.json');
    const createAppVersion = JSON.parse(createAppPackageJson).version

    if (!createAppVersion) {
      console.error(`Unable to find create-app version in ${createAppPackageJson}`)
      process.exit(1);
    }

    const out = `
## RHDH ${release} ${branch === "main" ? preRelaseInfo : ""}

<!-- source
https://github.com/redhat-developer/rhdh/blob/${branch}/backstage.json
-->

Based on [Backstage ${backstageVersion}](https://backstage.io/docs/releases/v${minorBackstageVersion}.0)

To bootstrap Backstage app that is compatible with RHDH 1.4, you can use:

\`\`\`bash
npx @backstage/create-app@${createAppVersion}
\`\`\`

### Frontend packages

${frontendTable}


If you want to check versions of other packages, you can check the 
[\`package.json\`](https://github.com/redhat-developer/rhdh/blob/${branch}/packages/app/package.json) in the
[\`app\`](https://github.com/redhat-developer/rhdh/tree/${branch}/packages/app) package 
in the \`${branch}\` branch of the [RHDH repository](https://github.com/redhat-developer/rhdh/tree/${branch}).

### Backend packages

${backendTable}


If you want to check versions of other packages, you can check the
[\`package.json\`](https://github.com/redhat-developer/rhdh/blob/${branch}/packages/backend/package.json) in the
[\`backend\`](https://github.com/redhat-developer/rhdh/tree/${branch}/packages/backend) package
in the \`${branch}\` branch of the [RHDH repository](https://github.com/redhat-developer/rhdh/tree/${branch}).
`

    allOutputs += out;
  }

  await writeToFile(outputFilePath, allOutputs);
}

await main();
