# Project Setup Instructions

## Reference Document

Please refer to the
[project documentation](https://docs.google.com/document/d/1OUA5uhsZN0KhUSAln_ohvBRg3hyVx3wyYyddUB-fjlQ/edit#heading=h.hg9hpw7e08uo)
and [documentation link](https://github.com/janus-idp/operator/pull/368) for detailed information
and guidelines.

## Database Setup

You can use either Azure Database for PostgreSQL - Flexible Server or Amazon RDS for PostgreSQL for
this project. Please follow the respective setup guides:

- [Azure Database for PostgreSQL - Flexible Server](https://learn.microsoft.com/en-gb/azure/postgresql/flexible-server/overview)
- [Amazon RDS for PostgreSQL](https://aws.amazon.com/rds/postgresql/)

## Configuration

### Database Connection

Define the values for the database connection in the `postgress-cred-secret.yaml` file. Here is a
template:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: postgress-cred-secret
type: Opaque
data:
  POSTGRES_PASSWORD: ""
  POSTGRES_PORT: ""
  POSTGRES_USER: ""
  POSTGRES_HOST: ""
```

Fill in the values for **POSTGRES_PASSWORD**, **POSTGRES_PORT**, **POSTGRES_USER**, and
**POSTGRES_HOST** with the appropriate credentials and connection details.

### Cluster Configuration

Replace the values for OCM_CLUSTER_TOKEN and K8S_CLUSTER_URL in the install.sh script.

Run install.sh

Verify if the installation was succeeded
