# Use nginx to serve the static files
FROM nginx:alpine

# Copy static files to nginx html directory
COPY index.html /usr/share/nginx/html/
COPY index.css /usr/share/nginx/html/
COPY index.js /usr/share/nginx/html/
COPY settings.js /usr/share/nginx/html/
COPY acquireToken.js /usr/share/nginx/html/
COPY img/ /usr/share/nginx/html/img/

# Copy custom nginx configuration if needed
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
