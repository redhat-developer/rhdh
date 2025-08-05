#!/bin/bash

# Test script with real data from the user
export AWS_EKS_PARENT_DOMAIN="rhdh.click"
export region="us-east-2"

echo "Testing with real data from find_available_domain_number function:"
echo "  region: ${region}"
echo "  AWS_EKS_PARENT_DOMAIN: ${AWS_EKS_PARENT_DOMAIN}"
echo ""

# Mock the AWS CLI with the real data provided
mock_aws_route53() {
    local command="$1"
    local args="$2"
    
    if [[ "$command" == "list-hosted-zones" ]]; then
        echo '{"HostedZones": [{"Id": "/hostedzone/Z09507351SUK2G0ZFZQ5L", "Name": "rhdh.click."}]}'
    elif [[ "$command" == "list-resource-record-sets" ]]; then
        # Real data from user's output - exact JSON format
        echo '[
    "eks-ci-1.eu-central-1.rhdh.click.",
    "_3770f9128c064734a6859ab018ce915d.eks-ci-1.eu-central-1.rhdh.click.",
    "eks-ci-1.us-east-2.rhdh.click.",
    "_4d5305ddad82908b8d3766c7eeffbf7e.eks-ci-1.us-east-2.rhdh.click."
]'
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

echo "=== Testing with real data ==="
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
echo "=== Testing regex pattern with real data ==="

# Test the regex pattern with the real records
real_records=(
    "eks-ci-1.eu-central-1.rhdh.click."
    "eks-ci-1.us-east-2.rhdh.click."
)

for record in "${real_records[@]}"; do
    if [[ "${record}" =~ eks-ci-([0-9]+)\.${region}\.${AWS_EKS_PARENT_DOMAIN} ]]; then
        echo "✅ MATCH: '${record}' -> number: ${BASH_REMATCH[1]}"
    else
        echo "❌ NO MATCH: '${record}' (expected for eu-central-1 record)"
    fi
done 