#!/bin/bash
set -e

# Script para deploy de workflows de exemplo do Orchestrator

NAMESPACE="orchestrator-infra"

echo "=== Deploying Sample Workflows for Orchestrator ==="

# Deploy do workflow de exemplo - User Onboarding
echo "=== Deploying User Onboarding Workflow ==="

# Criar ConfigMap com o workflow definition
cat << 'EOF' | oc apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: user-onboarding-workflow
  namespace: orchestrator-infra
data:
  workflow.sw.yaml: |
    id: user-onboarding
    version: '1.0'
    specVersion: '0.8'
    name: User Onboarding Workflow
    description: Workflow for onboarding new users
    start: CheckUserExists
    dataInputSchema:
      schema: schemas/user-input.json
      failOnValidationErrors: true
    functions:
      - name: checkUser
        operation: specs/user-service.yaml#checkUserExists
      - name: createUser
        operation: specs/user-service.yaml#createUser
      - name: sendWelcomeEmail
        operation: specs/notification-service.yaml#sendEmail
    states:
      - name: CheckUserExists
        type: operation
        actions:
          - name: checkUserAction
            functionRef:
              refName: checkUser
              arguments:
                email: "${ .email }"
        transition: UserDecision
      - name: UserDecision
        type: switch
        dataConditions:
          - condition: "${ .userExists == true }"
            transition: UserAlreadyExists
        defaultCondition:
          transition: CreateUser
      - name: CreateUser
        type: operation
        actions:
          - name: createUserAction
            functionRef:
              refName: createUser
              arguments:
                firstName: "${ .firstName }"
                lastName: "${ .lastName }"
                email: "${ .email }"
                department: "${ .department }"
        transition: SendWelcomeEmail
      - name: SendWelcomeEmail
        type: operation
        actions:
          - name: sendEmailAction
            functionRef:
              refName: sendWelcomeEmail
              arguments:
                to: "${ .email }"
                subject: "Welcome to our platform!"
                body: "Welcome ${ .firstName }! Your account has been created."
        end: true
      - name: UserAlreadyExists
        type: inject
        data:
          message: "User already exists"
        end: true
EOF

# Criar SonataFlow CR para o workflow
cat << EOF | oc apply -f -
apiVersion: sonataflow.org/v1alpha08
kind: SonataFlow
metadata:
  name: user-onboarding
  namespace: ${NAMESPACE}
  annotations:
    sonataflow.org/description: User Onboarding Workflow
    sonataflow.org/version: 1.0.0
spec:
  flow:
    id: user-onboarding
    version: '1.0'
    specVersion: '0.8'
    name: User Onboarding Workflow
    description: Workflow for onboarding new users
    start: CheckUserExists
    functions:
      - name: systemOut
        type: custom
        operation: sysout
    states:
      - name: CheckUserExists
        type: inject
        data:
          message: "Checking if user exists"
        transition: CreateUser
      - name: CreateUser
        type: inject
        data:
          message: "Creating new user"
        transition: Complete
      - name: Complete
        type: inject
        data:
          message: "User onboarding completed"
        end: true
EOF

# Deploy workflow de exemplo - Infrastructure Provisioning
echo "=== Deploying Infrastructure Provisioning Workflow ==="

cat << EOF | oc apply -f -
apiVersion: sonataflow.org/v1alpha08
kind: SonataFlow
metadata:
  name: infrastructure-provisioning
  namespace: ${NAMESPACE}
  annotations:
    sonataflow.org/description: Infrastructure Provisioning Workflow
    sonataflow.org/version: 1.0.0
spec:
  flow:
    id: infrastructure-provisioning
    version: '1.0'
    specVersion: '0.8'
    name: Infrastructure Provisioning
    description: Provisions cloud infrastructure resources
    start: ValidateRequest
    states:
      - name: ValidateRequest
        type: inject
        data:
          message: "Validating provisioning request"
        transition: ProvisionResources
      - name: ProvisionResources
        type: parallel
        branches:
          - name: provisionCompute
            actions:
              - name: createVM
                functionRef:
                  refName: systemOut
                  arguments:
                    message: "Creating virtual machine"
          - name: provisionStorage
            actions:
              - name: createStorage
                functionRef:
                  refName: systemOut
                  arguments:
                    message: "Creating storage volume"
          - name: provisionNetwork
            actions:
              - name: createNetwork
                functionRef:
                  refName: systemOut
                  arguments:
                    message: "Configuring network"
        transition: ValidateProvisioning
      - name: ValidateProvisioning
        type: inject
        data:
          message: "Validating provisioned resources"
        transition: NotifyCompletion
      - name: NotifyCompletion
        type: inject
        data:
          message: "Infrastructure provisioning completed successfully"
        end: true
    functions:
      - name: systemOut
        type: custom
        operation: sysout
EOF

# Criar Service Account para os workflows
cat << EOF | oc apply -f -
apiVersion: v1
kind: ServiceAccount
metadata:
  name: orchestrator-workflows-sa
  namespace: ${NAMESPACE}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: orchestrator-workflows-rolebinding
  namespace: ${NAMESPACE}
subjects:
  - kind: ServiceAccount
    name: orchestrator-workflows-sa
    namespace: ${NAMESPACE}
roleRef:
  kind: ClusterRole
  name: view
  apiGroup: rbac.authorization.k8s.io
EOF

echo "=== Waiting for workflows to be ready ==="
sleep 20

# Verificar status dos workflows
echo "Deployed workflows:"
oc get sonataflow -n ${NAMESPACE}

echo "=== Sample workflows deployment completed ==="
echo ""
echo "Available workflows:"
echo "  - user-onboarding: User onboarding process"
echo "  - infrastructure-provisioning: Cloud infrastructure provisioning"
echo ""
echo "Access the workflows through the Orchestrator UI or API endpoints"
