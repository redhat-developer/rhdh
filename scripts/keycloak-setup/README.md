
# How to use

Create new Openshift project 'keycloak':

```
oc new-project keycloak
```

Install Keycloak operator with help of cluster console UI.

Install keycloak:

```
./deploy-keycloak.sh --generate-certs keycloak.<openshift-cluster-domain>
```

Uninstall keycloak:

```
./deploy-keycloak.sh --uninstall all 
```
