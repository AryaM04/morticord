# The image of the backup service: the PostgreSQL client tools of the
# database image, and "age" for the optional encryption of the backup files.
# Build it from the repository root: docker build -f infra/backup/Dockerfile .
FROM postgres:16-alpine
RUN apk add --no-cache age
COPY infra/scripts/backup.sh /usr/local/bin/backup.sh
ENTRYPOINT ["/bin/sh", "/usr/local/bin/backup.sh"]
CMD ["loop"]
