#!/bin/bash

# Test script for find_available_domain_number function
# Set the required environment variables
export AWS_EKS_PARENT_DOMAIN="rhdh.click"
export region="us-east-2"

echo "Testing find_available_domain_number function with:"
echo "  region: ${region}"
echo "  AWS_EKS_PARENT_DOMAIN: ${AWS_EKS_PARENT_DOMAIN}"
echo ""

# Source the aws.sh file to get the function
source .ibm/pipelines/cluster/eks/aws.sh

# Test the function
echo "=== Testing find_available_domain_number function ==="
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
echo "=== Testing generate_dynamic_domain_name function ==="
domain_name=$(generate_dynamic_domain_name)

if [[ $? -eq 0 ]]; then
    echo ""
    echo "✅ SUCCESS: Generated domain name: ${domain_name}"
else
    echo ""
    echo "❌ ERROR: Function failed with exit code $?"
fi 