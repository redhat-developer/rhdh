#!/bin/bash

# Mock test script for find_available_domain_number function
# This simulates the function behavior without requiring actual AWS resources

export AWS_EKS_PARENT_DOMAIN="rhdh.click"
export region="us-east-2"

echo "Testing find_available_domain_number function with:"
echo "  region: ${region}"
echo "  AWS_EKS_PARENT_DOMAIN: ${AWS_EKS_PARENT_DOMAIN}"
echo ""

# Mock the AWS CLI commands for testing
mock_aws_route53() {
    local command="$1"
    local args="$2"
    
    if [[ "$command" == "list-hosted-zones" ]]; then
        # Mock hosted zone response
        echo '{"HostedZones": [{"Id": "/hostedzone/Z1234567890ABC", "Name": "rhdh.click."}]}'
    elif [[ "$command" == "list-resource-record-sets" ]]; then
        # Mock existing records - simulate some existing eks-ci domains
        echo '{"ResourceRecordSets": [
            {"Name": "eks-ci-1.us-east-2.rhdh.click."},
            {"Name": "eks-ci-3.us-east-2.rhdh.click."},
            {"Name": "eks-ci-5.us-east-2.rhdh.click."},
            {"Name": "other-record.rhdh.click."}
        ]}'
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

echo "=== Testing find_available_domain_number function (MOCK) ==="
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
echo "=== Testing with different mock data ==="

# Test with no existing records
mock_aws_route53() {
    local command="$1"
    local args="$2"
    
    if [[ "$command" == "list-hosted-zones" ]]; then
        echo '{"HostedZones": [{"Id": "/hostedzone/Z1234567890ABC", "Name": "rhdh.click."}]}'
    elif [[ "$command" == "list-resource-record-sets" ]]; then
        # Mock no existing eks-ci records
        echo '{"ResourceRecordSets": [
            {"Name": "other-record.rhdh.click."}
        ]}'
    fi
}

echo "Testing with no existing eks-ci records..."
result2=$(find_available_domain_number "${region}")

if [[ $? -eq 0 ]]; then
    echo "✅ SUCCESS: Function returned available number: ${result2}"
    echo "Generated domain name would be: eks-ci-${result2}.${region}.${AWS_EKS_PARENT_DOMAIN}"
else
    echo "❌ ERROR: Function failed with exit code $?"
fi

echo ""
echo "=== Testing with sequential existing records ==="

# Test with sequential records (1, 2, 3, 4, 6 - missing 5)
mock_aws_route53() {
    local command="$1"
    local args="$2"
    
    if [[ "$command" == "list-hosted-zones" ]]; then
        echo '{"HostedZones": [{"Id": "/hostedzone/Z1234567890ABC", "Name": "rhdh.click."}]}'
    elif [[ "$command" == "list-resource-record-sets" ]]; then
        # Mock sequential records with gap
        echo '{"ResourceRecordSets": [
            {"Name": "eks-ci-1.us-east-2.rhdh.click."},
            {"Name": "eks-ci-2.us-east-2.rhdh.click."},
            {"Name": "eks-ci-3.us-east-2.rhdh.click."},
            {"Name": "eks-ci-4.us-east-2.rhdh.click."},
            {"Name": "eks-ci-6.us-east-2.rhdh.click."}
        ]}'
    fi
}

echo "Testing with sequential records (1,2,3,4,6 - should find 5)..."
result3=$(find_available_domain_number "${region}")

if [[ $? -eq 0 ]]; then
    echo "✅ SUCCESS: Function returned available number: ${result3}"
    echo "Generated domain name would be: eks-ci-${result3}.${region}.${AWS_EKS_PARENT_DOMAIN}"
else
    echo "❌ ERROR: Function failed with exit code $?"
fi 