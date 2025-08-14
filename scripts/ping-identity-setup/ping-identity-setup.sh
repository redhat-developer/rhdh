#!/bin/bash
# Check for expected args
if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <secretsFile> <numUsers> <numGroups>"
  exit 1
fi

secretsFile=$1
numUsers=$2
numGroups=$3

# Load env vars
if [ ! -f "$secretsFile" ]; then
  echo "Secrets file not found."
  exit 1
fi
source "$secretsFile"

# Check if env vars are all set
if [ -z "$PING_IDENTITY_API_PATH" ] || [ -z "$PING_IDENTITY_AUTH_PATH" ] || [ -z "$PING_IDENTITY_ENV_ID" ] || [ -z "$PING_IDENTITY_CLIENT_ID" ] || [ -z "$PING_IDENTITY_CLIENT_SECRET" ]; then
  echo "One or more required variables is missing from the secrets file."
  exit 1
fi

# Fetch access token
credentials=$(echo -n "$PING_IDENTITY_CLIENT_ID:$PING_IDENTITY_CLIENT_SECRET" | base64)
response=$(curl -s --request POST \
  --url "$PING_IDENTITY_AUTH_PATH/$PING_IDENTITY_ENV_ID/as/token" \
  --header "Authorization: Basic $credentials" \
  --header "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials")
access_token=$(echo $response | jq -r .access_token)

if [ "$access_token" == "null" ]; then
  echo "Error retrieving access token: $response"
  exit 1
fi

# Delete all existing users and groups
group_ids=$(curl -s --location --request GET "$PING_IDENTITY_API_PATH/environments/$PING_IDENTITY_ENV_ID/groups" \
  --header "Authorization: Bearer $access_token" \
  --header "Content-Type: application/json" | jq -r '._embedded.groups[].id')

for group_id in $group_ids; do
  if [ -n "$group_id" ]; then
    curl -s --location --request DELETE "$PING_IDENTITY_API_PATH/environments/$PING_IDENTITY_ENV_ID/groups/$group_id" \
      --header "Authorization: Bearer $access_token"
  fi
done

user_ids=$(curl -s --location --request GET "$PING_IDENTITY_API_PATH/environments/$PING_IDENTITY_ENV_ID/users" \
  --header "Authorization: Bearer $access_token" \
  --header "Content-Type: application/json" | jq -r '._embedded.users[].id')

for user_id in $user_ids; do
  if [ -n "$user_id" ]; then
    curl -s --location --request DELETE "$PING_IDENTITY_API_PATH/environments/$PING_IDENTITY_ENV_ID/users/$user_id" \
      --header "Authorization: Bearer $access_token"
  fi
done

# Create Users
echo "Adding $numUsers users..."

user_ids=()
for i in $(seq 1 $numUsers); do
  user="tester$i"
  create_user_response=$(curl -s --request POST \
    --url "$PING_IDENTITY_API_PATH/environments/$PING_IDENTITY_ENV_ID/users" \
    --header "Authorization: Bearer $access_token" \
    --header "Content-Type: application/json" \
    --data-raw "{
      \"email\": \"$user@example.com\",
      \"name\": {
        \"given\": \"$user\",
        \"family\": \"User\"
      },
      \"username\": \"$user\"
    }")
  user_id=$(echo "$create_user_response" | jq -r '.id')
  user_ids+=("$user_id")
  echo "Created user: $user, ID: $user_id"
done

# Create Groups
echo "Adding $numGroups groups..."

group_ids=()
for i in $(seq 1 $numGroups); do
  group="group$i"
  create_group_response=$(curl -s --request POST \
    --url "$PING_IDENTITY_API_PATH/environments/$PING_IDENTITY_ENV_ID/groups" \
    --header "Authorization: Bearer $access_token" \
    --header "Content-Type: application/json" \
    --data-raw "{
      \"name\": \"$group\",
      \"description\": \"This is $group\"
    }")
  group_id=$(echo "$create_group_response" | jq -r '.id')
  group_ids+=("$group_id")
  echo "Created group: $group, ID: $group_id"
done

# Set up group memberships and subgroups - modify as needed for testing
# Example: Add tester1 and tester2 to group1
for user_id in "${user_ids[@]:0:2}"; do
  add_user_to_group_response=$(curl -s --request POST \
    --url "$PING_IDENTITY_API_PATH/environments/$PING_IDENTITY_ENV_ID/users/$user_id/memberOfGroups" \
    --header "Authorization: Bearer $access_token" \
    --header "Content-Type: application/json" \
    --data-raw "{
      \"id\": \"${group_ids[0]}\"
    }")
  echo "Added user ID: $user_id to group1 (ID: ${group_ids[0]})"
done

# Example: Set group3 as a subgroup of group1
nest_group_response=$(curl -s --request POST \
  --url "$PING_IDENTITY_API_PATH/environments/$PING_IDENTITY_ENV_ID/groups/${group_ids[2]}/memberOfGroups" \
  --header "Authorization: Bearer $access_token" \
  --header "Content-Type: application/json" \
  --data-raw "{
    \"id\": \"${group_ids[0]}\"
  }")
echo "Nested group3 (ID: ${group_ids[2]}) into group1 (ID: ${group_ids[0]})"