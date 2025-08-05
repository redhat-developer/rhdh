#!/bin/bash

# Test the regex pattern used in the function
export AWS_EKS_PARENT_DOMAIN="rhdh.click"
export region="us-east-2"

echo "Testing regex pattern with:"
echo "  region: ${region}"
echo "  AWS_EKS_PARENT_DOMAIN: ${AWS_EKS_PARENT_DOMAIN}"
echo ""

# Test cases
test_cases=(
    "eks-ci-1.us-east-2.rhdh.click."
    "eks-ci-42.us-east-2.rhdh.click."
    "eks-ci-999.us-east-2.rhdh.click."
    "other-record.rhdh.click."
    "eks-ci-1.us-west-1.rhdh.click."
    "eks-ci-abc.us-east-2.rhdh.click."
    "eks-ci-1.us-east-2.other-domain.com."
)

echo "=== Testing regex pattern: eks-ci-([0-9]+)\.${region}\.${AWS_EKS_PARENT_DOMAIN} ==="
echo ""

for test_case in "${test_cases[@]}"; do
    if [[ "${test_case}" =~ eks-ci-([0-9]+)\.${region}\.${AWS_EKS_PARENT_DOMAIN} ]]; then
        echo "✅ MATCH: '${test_case}' -> number: ${BASH_REMATCH[1]}"
    else
        echo "❌ NO MATCH: '${test_case}'"
    fi
done

echo ""
echo "=== Testing with different regions ==="

# Test with different regions
test_regions=("us-east-1" "us-west-2" "eu-west-1")

for test_region in "${test_regions[@]}"; do
    test_record="eks-ci-5.${test_region}.${AWS_EKS_PARENT_DOMAIN}."
    if [[ "${test_record}" =~ eks-ci-([0-9]+)\.${test_region}\.${AWS_EKS_PARENT_DOMAIN} ]]; then
        echo "✅ MATCH: '${test_record}' -> number: ${BASH_REMATCH[1]}"
    else
        echo "❌ NO MATCH: '${test_record}'"
    fi
done 