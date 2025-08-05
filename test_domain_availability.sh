#!/bin/bash

# Test script for the new domain availability checking approach
export AWS_EKS_PARENT_DOMAIN="rhdh.click"
export region="us-east-2"

echo "Testing new domain availability checking approach:"
echo "  region: ${region}"
echo "  AWS_EKS_PARENT_DOMAIN: ${AWS_EKS_PARENT_DOMAIN}"
echo ""

# Mock the AWS CLI with realistic data
mock_aws_route53() {
    local command="$1"
    local args="$2"
    
    if [[ "$command" == "list-hosted-zones" ]]; then
        echo '{"HostedZones": [{"Id": "/hostedzone/Z09507351SUK2G0ZFZQ5L", "Name": "rhdh.click."}]}'
    elif [[ "$command" == "list-resource-record-sets" ]]; then
        # Check if this is a specific domain query or general query
        if [[ "$args" == *"eks-ci-1.us-east-2.rhdh.click"* ]]; then
            # Domain exists - return the domain name
            echo '["eks-ci-1.us-east-2.rhdh.click."]'
        elif [[ "$args" == *"eks-ci-2.us-east-2.rhdh.click"* ]]; then
            # Domain doesn't exist - return empty array
            echo '[]'
        elif [[ "$args" == *"eks-ci-3.us-east-2.rhdh.click"* ]]; then
            # Domain exists
            echo '["eks-ci-3.us-east-2.rhdh.click."]'
        elif [[ "$args" == *"eks-ci-4.us-east-2.rhdh.click"* ]]; then
            # Domain doesn't exist - return empty array
            echo '[]'
        else
            # General query - return all eks-ci records
            echo '[
    "eks-ci-1.eu-central-1.rhdh.click.",
    "_3770f9128c064734a6859ab018ce915d.eks-ci-1.eu-central-1.rhdh.click.",
    "eks-ci-1.us-east-2.rhdh.click.",
    "_4d5305ddad82908b8d3766c7eeffbf7e.eks-ci-1.us-east-2.rhdh.click.",
    "eks-ci-3.us-east-2.rhdh.click."
]'
        fi
    fi
}

# Override aws command for testing
aws() {
    if [[ "$1" == "route53" ]]; then
        mock_aws_route53 "$2" "$*"
    else
        echo "Mock aws command: $*" >&2
        return 1
    fi
}

# Source the aws.sh file to get the function
source .ibm/pipelines/cluster/eks/aws.sh

echo "=== Testing new domain availability approach ==="
result=$(find_available_domain_number "${region}")

if [[ $? -eq 0 ]]; then
    echo ""
    echo "✅ SUCCESS: Function returned available number: ${result}"
    echo ""
    echo "Generated domain name would be: eks-ci-${result}.${region}.${AWS_EKS_PARENT_DOMAIN}"
else
    echo ""
    echo "❌ ERROR: Function failed with exit code $?"
fi

echo ""
echo "=== Expected behavior ==="
echo "Based on the mock data:"
echo "- eks-ci-1.us-east-2.rhdh.click exists (should skip)"
echo "- eks-ci-2.us-east-2.rhdh.click doesn't exist (should find this)"
echo "- eks-ci-3.us-east-2.rhdh.click exists (should skip)"
echo "- eks-ci-4.us-east-2.rhdh.click doesn't exist (should find this if 2 doesn't work)"
echo ""
echo "Expected result: 2 (first available domain)" 