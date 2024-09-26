# Stare Aparaty Webpage

This repository contains the code for the Stare Aparaty webpage, which promotes vintage cameras and related products. The webpage is hosted on AWS S3 and includes Amazon affiliate links for monetization.

## Deployment Instructions

Follow these steps to deploy the webpage on AWS S3:

### Prerequisites

- AWS CLI installed and configured with your AWS credentials
- Access to the AWS Management Console
- Domain registered with a DNS provider (e.g., Namecheap)

### Step 1: Set Up AWS CLI

1. Install the AWS CLI if not already installed.
2. Configure the AWS CLI with your credentials:
   ```bash
   aws configure
   ```
   Enter your AWS Access Key ID, Secret Access Key, default region (e.g., `eu-central-1`), and output format (e.g., `json`).

### Step 2: Create an S3 Bucket

1. Create a new S3 bucket for hosting the webpage:
   ```bash
   aws s3api create-bucket --bucket your-bucket-name --region eu-central-1 --create-bucket-configuration LocationConstraint=eu-central-1
   ```
   Replace `your-bucket-name` with a unique bucket name.

2. Enable static website hosting for the bucket:
   ```bash
   aws s3 website s3://your-bucket-name/ --index-document index.html
   ```

### Step 3: Configure Bucket Policy

1. Create a bucket policy to allow public access:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "PublicReadGetObject",
         "Effect": "Allow",
         "Principal": "*",
         "Action": "s3:GetObject",
         "Resource": "arn:aws:s3:::your-bucket-name/*"
       }
     ]
   }
   ```

2. Apply the bucket policy:
   ```bash
   aws s3api put-bucket-policy --bucket your-bucket-name --policy file://bucket_policy.json
   ```

### Step 4: Upload the Webpage

1. Upload the `vintage_cameras.html` file to the S3 bucket as `index.html`:
   ```bash
   aws s3 cp vintage_cameras.html s3://your-bucket-name/index.html
   ```

### Step 5: Update DNS Settings

1. Log in to your DNS provider (e.g., Namecheap) and update the DNS settings:
   - Add a CNAME record pointing your domain to the S3 bucket URL (e.g., `your-bucket-name.s3-website.eu-central-1.amazonaws.com`).

2. Save the changes and wait for DNS propagation.

### Step 6: Verify Deployment

1. Access your domain in a web browser to verify that the webpage is live and accessible.

## Additional Information

- The webpage includes Amazon affiliate links using the affiliate ID `blueprintkc08-21`.
- The webpage features sections for vintage cameras and films, each with a brief description and an image.

For any questions or issues, please contact the repository maintainer.
