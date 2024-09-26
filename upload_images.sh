#!/bin/bash

# Array of image filenames
images=(
    "kodak-portra-400.jpg"
    "fujifilm-superia-x-tra-400.jpg"
    "ilford-hp5-plus.jpg"
    "kodak-tri-x-400.jpg"
)

# S3 bucket name
bucket="stareaparaty.com"

# Loop through the images and upload them to S3
for image in "${images[@]}"
do
    if [ -f "$image" ]; then
        aws s3 cp "$image" "s3://$bucket/$image"
        echo "Uploaded $image to S3"
    else
        echo "Warning: $image not found in the current directory"
    fi
done

echo "Image upload complete"
